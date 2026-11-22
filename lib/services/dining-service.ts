import { eq, and, sql, or } from "drizzle-orm";
import { getDb } from "../../db/index";
import {
  diningLocations,
  diningTables,
  diningReservations,
  diningMenuItems,
  diningModifierGroups,
  diningModifierOptions,
  diningTableSessions,
  diningOrders,
  diningOrderItems,
  diningKitchenTickets,
  diningBills,
  diningPayments,
  auditEvents,
  idempotencyKeys,
} from "../../db/schema";
import { TenantContext, checkPermission } from "../tenant";
import { recordAuditEvent } from "../audit";
import { calculateDiningAmounts } from "../money";
import { checkIdempotency, saveIdempotency } from "../idempotency";

function writable(context: TenantContext) {
  const permission = checkPermission(context, "operator");
  if (!permission.allowed) throw new Error(permission.message);
}
// NOT NULL actor_id is an intentional transaction guard. If a condition became
// stale between read and write, SQLite/D1 aborts and rolls back the whole batch.
function guard(context: TenantContext, condition: ReturnType<typeof sql>, action: string, entityId: string, after: unknown, reason?: string) {
  return getDb().insert(auditEvents).values({id: crypto.randomUUID(), organizationId: context.organizationId, actorId: sql`CASE WHEN ${condition} THEN ${context.userId} ELSE NULL END`, actorRole: context.role, action, entityType: "dining", entityId, afterValue: JSON.stringify(after), reason: reason || null, requestId: context.requestId});
}

export class DiningService {
  /**
   * D01 & D04: Place Order via QR Token or Staff
   */
  static async placeOrder(context: TenantContext, params: {
    sessionToken: string;
    orderType?: "dine_in" | "takeout";
    paymentMethod?: "cash" | "mock_card";
    items: Array<{
      menuItemId: string;
      quantity: number;
      modifiers?: Array<{ groupId: string; optionId: string }>;
    }>;
    idempotencyKey?: string;
  }) {
    writable(context);
    if (!Array.isArray(params.items) || !params.items.length || params.items.length > 100) throw new Error("點餐單不得為空或超過100項");
    const db = getDb();
    const isTakeout = params.orderType === "takeout";
    if (isTakeout && !["cash", "mock_card"].includes(params.paymentMethod || "")) throw new Error("外帶訂單須選擇現金或模擬刷卡收款");
    const requestHash = JSON.stringify({sessionToken: params.sessionToken, orderType: params.orderType || "dine_in", paymentMethod: params.paymentMethod, items: params.items});

    // Verify Session Token (D03)
    const sessionRes = await db.select().from(diningTableSessions)
      .where(and(
        eq(diningTableSessions.organizationId, context.organizationId),
        eq(diningTableSessions.sessionToken, params.sessionToken)
      ))
      .limit(1);

    if (!isTakeout && sessionRes.length === 0) {
      throw new Error("無效的點餐桌次憑證 (QR Token)，請洽服務人員 (D03)");
    }
    const session = sessionRes[0];
    if (!isTakeout && session.status !== "active") {
      throw new Error("此桌次已結帳離席，原QR碼已失效，無法追加點餐 (D03)");
    }

    // Idempotency check (D04 / C06)
    if (params.idempotencyKey) {
      const idem = await checkIdempotency(context, params.idempotencyKey, "/api/dining/order");
      if (idem.isDuplicate && idem.cachedResponse) {
        const [saved] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, context.organizationId), eq(idempotencyKeys.key, params.idempotencyKey), eq(idempotencyKeys.endpoint, "/api/dining/order"))).limit(1);
        if (saved.requestHash !== requestHash) throw new Error("相同重送識別碼不可搭配不同點餐內容");
        return idem.cachedResponse;
      }
    }

    let subtotal = 0;
    const resolvedOrderItems: Array<{
      menuItem: any;
      quantity: number;
      unitPrice: number;
      modifiersJson: string | null;
      modifiersText: string;
      lineTotal: number;
    }> = [];

    for (const itemInput of params.items) {
      if (!Number.isSafeInteger(itemInput.quantity) || itemInput.quantity <= 0 || itemInput.quantity > 100) throw new Error("餐點數量必須是1至100的整數");
      const menuRes = await db.select().from(diningMenuItems)
        .where(and(
          eq(diningMenuItems.organizationId, context.organizationId),
          eq(diningMenuItems.id, itemInput.menuItemId)
        ))
        .limit(1);

      if (menuRes.length === 0) throw new Error("餐點項目不存在");
      const menuItem = menuRes[0];

      // D01: Check sold out status (authoritative backend check)
      if (menuItem.isSoldOut) {
        throw new Error(`餐點「${menuItem.name}」已售完，後端嚴格拒絕下單 (D01)`);
      }

      // Check required modifier groups (D01)
      let modifierAddonPrice = 0;
      const modNames: string[] = [];
      const selectedMods = itemInput.modifiers || [];
      if (new Set(selectedMods.map(m => m.optionId)).size !== selectedMods.length) throw new Error("加料選項不可重複");
      const groups = await db.select().from(diningModifierGroups).where(eq(diningModifierGroups.organizationId, context.organizationId));
      for (const group of groups) {
        if (selectedMods.filter(m => m.groupId === group.id).length > group.maxSelection) throw new Error(`「${group.name}」超過可選數量`);
      }

      // Check for beverage sweet requirement or general required groups
      if (menuItem.category === "飲品") {
        const sweetGroups = await db.select().from(diningModifierGroups)
          .where(and(
            eq(diningModifierGroups.organizationId, context.organizationId),
            eq(diningModifierGroups.isRequired, true)
          ));

        for (const reqGroup of sweetGroups) {
          const selected = selectedMods.filter(m => m.groupId === reqGroup.id);
          if (selected.length === 0) {
            throw new Error(`點選「${menuItem.name}」必須選擇「${reqGroup.name}」，未填不得點餐 (D01)`);
          }
        }
      }

      for (const m of selectedMods) {
        const optRes = await db.select().from(diningModifierOptions)
          .where(and(eq(diningModifierOptions.id, m.optionId), eq(diningModifierOptions.organizationId, context.organizationId), eq(diningModifierOptions.groupId, m.groupId)))
          .limit(1);
        if (!optRes.length) throw new Error("加料選項或規格不存在於目前餐廳");
        if (optRes.length > 0) {
          modifierAddonPrice += optRes[0].additionalPrice;
          modNames.push(optRes[0].name);
        }
      }

      const unitPrice = menuItem.price + modifierAddonPrice;
      const qty = Math.max(1, itemInput.quantity);
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      resolvedOrderItems.push({
        menuItem,
        quantity: qty,
        unitPrice,
        modifiersJson: selectedMods.length > 0 ? JSON.stringify(modNames) : null,
        modifiersText: modNames.join("、"),
        lineTotal,
      });
    }

    // Get location service fee
    const locRes = await db.select().from(diningLocations)
      .where(eq(diningLocations.organizationId, context.organizationId))
      .limit(1);
    const serviceFeeRate = isTakeout ? 0 : locRes[0]?.serviceFeeRate ?? 10;

    const amounts = calculateDiningAmounts({
      subtotal,
      serviceFeeRatePercent: serviceFeeRate,
    });

    const orderId = `din_ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const takeoutNumber = isTakeout ? `TO-${crypto.randomUUID()}` : null;
    const conditions = isTakeout ? [sql`1 = 1`] : [sql`EXISTS (SELECT 1 FROM dining_table_sessions WHERE organization_id = ${context.organizationId} AND id = ${session.id} AND status = 'active')`];
    for (const resolved of resolvedOrderItems) conditions.push(sql`EXISTS (SELECT 1 FROM dining_menu_items WHERE id = ${resolved.menuItem.id} AND organization_id = ${context.organizationId} AND is_sold_out = 0 AND price = ${resolved.menuItem.price})`);
    if (params.idempotencyKey) conditions.push(sql`NOT EXISTS (SELECT 1 FROM idempotency_keys WHERE organization_id = ${context.organizationId} AND key = ${params.idempotencyKey} AND endpoint = '/api/dining/order')`);
    const queries: any[] = [guard(context, sql.join(conditions, sql` AND `), "DINING_ORDER", orderId, {subtotal, items: params.items})];
    queries.push(db.insert(diningOrders).values({
      id: orderId,
      organizationId: context.organizationId,
      sessionId: isTakeout ? null : session.id,
      orderType: isTakeout ? "takeout" : "dine_in",
      takeoutNumber,
      subtotal: amounts.subtotal,
      serviceCharge: amounts.serviceCharge,
      totalAmount: amounts.finalAmount,
      status: "placed",
      idempotencyKey: params.idempotencyKey || null,
    }));

    for (const rItem of resolvedOrderItems) {
      const orderItemId = `doi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      queries.push(db.insert(diningOrderItems).values({
        id: orderItemId,
        organizationId: context.organizationId,
        orderId,
        menuItemId: rItem.menuItem.id,
        itemName: rItem.menuItem.name,
        unitPrice: rItem.unitPrice,
        quantity: rItem.quantity,
        modifiersJson: rItem.modifiersJson,
        lineTotal: rItem.lineTotal,
        status: "pending",
      }));

      // Dispatch to Kitchen KDS station (D05)
      queries.push(db.insert(diningKitchenTickets).values({
        id: `kt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        orderId,
        orderItemId,
        station: rItem.menuItem.station,
        itemName: rItem.menuItem.name,
        quantity: rItem.quantity,
        modifiersText: rItem.modifiersText,
        status: "received",
      }));
    }

    const result = {
      success: true,
      orderId,
      subtotal: amounts.subtotal,
      serviceCharge: amounts.serviceCharge,
      finalAmount: amounts.finalAmount,
      itemCount: resolvedOrderItems.length,
      takeoutNumber,
      paymentStatus: isTakeout ? "paid" : "unpaid",
    };

    if (isTakeout) {
      const billId = crypto.randomUUID();
      queries.push(db.insert(diningBills).values({id: billId, organizationId: context.organizationId, sessionId: null, orderId, subtotal: amounts.subtotal, serviceCharge: 0, finalAmount: amounts.finalAmount, paidAmount: amounts.finalAmount, status: "paid"}));
      queries.push(db.insert(diningPayments).values({id: crypto.randomUUID(), organizationId: context.organizationId, billId, amount: amounts.finalAmount, paymentMethod: params.paymentMethod!, splitIndex: 1}));
    }

    if (params.idempotencyKey) {
      queries.push(db.insert(idempotencyKeys).values({id: crypto.randomUUID(), organizationId: context.organizationId, key: params.idempotencyKey, endpoint: "/api/dining/order", requestHash, responseStatus: 200, responseBody: JSON.stringify(result)}));
    }
    try { await db.batch(queries as any); } catch(error) {
      if (params.idempotencyKey) {
        const [saved] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.organizationId, context.organizationId), eq(idempotencyKeys.key, params.idempotencyKey), eq(idempotencyKeys.endpoint, "/api/dining/order"))).limit(1);
        if (saved && saved.requestHash === requestHash) return JSON.parse(saved.responseBody);
      }
      throw new Error("點餐狀態已變更或桌次已結帳，請重新整理後再送單", {cause: error});
    }
    return result;
  }

  /**
   * D02: Table Reservation with conflict detection & capacity check
   */
  static async reserveTable(context: TenantContext, params: {
    tableId: string;
    customerName: string;
    customerPhone: string;
    guestCount: number;
    reservationTime: string; // e.g. "2026-10-30 18:00"
  }) {
    writable(context);
    if (!Number.isSafeInteger(params.guestCount) || params.guestCount <= 0) throw new Error("預約人數必須是正整數");
    if (!params.customerName.trim() || !params.customerPhone.trim() || params.customerName.length > 100 || params.customerPhone.length > 30) throw new Error("請填寫有效的姓名與聯絡電話");
    const dateText = params.reservationTime.includes("T") ? params.reservationTime : `${params.reservationTime.replace(" ", "T")}:00+08:00`;
    if (!Number.isFinite(Date.parse(dateText))) throw new Error("預約日期格式錯誤");
    params = {...params, reservationTime: new Date(dateText).toISOString()};
    const db = getDb();
    const tableRes = await db.select().from(diningTables)
      .where(and(
        eq(diningTables.organizationId, context.organizationId),
        eq(diningTables.id, params.tableId)
      ))
      .limit(1);

    if (tableRes.length === 0) throw new Error("桌位不存在");
    const table = tableRes[0];

    if (params.guestCount > table.capacity) {
      throw new Error(`預約人數 (${params.guestCount}人) 超過此桌容納上限 (${table.capacity}人) (D02)`);
    }

    // Check conflict at same time slot
    const conflict = await db.select().from(diningReservations)
      .where(and(
        eq(diningReservations.organizationId, context.organizationId),
        eq(diningReservations.tableId, params.tableId),
        sql`julianday(${diningReservations.reservationTime}) < julianday(${params.reservationTime}, '+90 minutes')`,
        sql`julianday(${diningReservations.reservationTime}, '+90 minutes') > julianday(${params.reservationTime})`,
        eq(diningReservations.status, "confirmed")
      ))
      .limit(1);

    if (conflict.length > 0) {
      throw new Error(`同桌同時段 (${params.reservationTime}) 已有預約，系統拒絕重複預約 (D02)`);
    }

    const resId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try { await db.batch([
      guard(context, sql`NOT EXISTS (SELECT 1 FROM dining_reservations WHERE organization_id = ${context.organizationId} AND table_id = ${params.tableId} AND julianday(reservation_time) < julianday(${params.reservationTime}, '+90 minutes') AND julianday(reservation_time, '+90 minutes') > julianday(${params.reservationTime}) AND status = 'confirmed')`, "DINING_RESERVATION", resId, {...params, durationMinutes: 90}),
      db.insert(diningReservations).values({
      id: resId,
      organizationId: context.organizationId,
      locationId: table.locationId,
      tableId: params.tableId,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      guestCount: params.guestCount,
      reservationTime: params.reservationTime,
      status: "confirmed",
    })]); } catch(error) {throw new Error("同桌同時段已有預約，系統拒絕重複預約 (D02)", {cause: error});}

    return { success: true, reservationId: resId };
  }

  /**
   * D05: Kitchen Display System (KDS) transition: received -> cooking -> done -> served
   */
  static async urgeKitchenTicket(context: TenantContext, params: {ticketId: string}) {
    writable(context);
    const db = getDb();
    const condition = sql`EXISTS (SELECT 1 FROM dining_kitchen_tickets WHERE id = ${params.ticketId} AND organization_id = ${context.organizationId} AND status != 'served')`;
    try {await db.batch([guard(context, condition, "DINING_URGENT", params.ticketId, {urgentFlag: true}), db.update(diningKitchenTickets).set({urgentFlag: true}).where(and(eq(diningKitchenTickets.id, params.ticketId), eq(diningKitchenTickets.organizationId, context.organizationId)))]);}
    catch(error) {throw new Error("出餐單不存在或已送餐，無法催單", {cause: error});}
    return {success: true, ticketId: params.ticketId, urgentFlag: true};
  }

  static async updateKdsTicketStatus(context: TenantContext, params: {
    ticketId: string;
    newStatus: "cooking" | "done" | "served";
  }) {
    writable(context);
    const db = getDb();
    const tickets = await db.select().from(diningKitchenTickets)
      .where(and(
        eq(diningKitchenTickets.organizationId, context.organizationId),
        eq(diningKitchenTickets.id, params.ticketId)
      ))
      .limit(1);

    if (tickets.length === 0) throw new Error("找不到廚房出餐單");
    const ticket = tickets[0];

    // Status machine validation: received -> cooking -> done -> served
    const validNext: Record<string, string[]> = {
      received: ["cooking"],
      cooking: ["done"],
      done: ["served"],
      served: [],
    };

    const allowed = validNext[ticket.status] || [];
    if (!allowed.includes(params.newStatus)) {
      throw new Error(`非法狀態流轉！目前為「${ticket.status}」，不可跳過或倒退至「${params.newStatus}」 (D05)`);
    }

    const queries: any[] = [guard(context, sql`EXISTS (SELECT 1 FROM dining_kitchen_tickets WHERE id = ${ticket.id} AND organization_id = ${context.organizationId} AND status = ${ticket.status}) AND EXISTS (SELECT 1 FROM dining_order_items WHERE id = ${ticket.orderItemId} AND status != 'cancelled')`, "DINING_KDS", ticket.id, params)];
    queries.push(db.update(diningKitchenTickets)
      .set({ status: params.newStatus })
      .where(eq(diningKitchenTickets.id, params.ticketId)));

    // Also update order item status
    const itemStatusMap: Record<string, string> = {
      cooking: "preparing",
      done: "ready",
      served: "served",
    };
    if (ticket.orderItemId) {
      queries.push(db.update(diningOrderItems)
        .set({ status: itemStatusMap[params.newStatus] || "preparing" })
        .where(eq(diningOrderItems.id, ticket.orderItemId)));
    }
    if (params.newStatus === "served") queries.push(db.update(diningOrders).set({status: "completed"}).where(and(eq(diningOrders.id, ticket.orderId), eq(diningOrders.organizationId, context.organizationId), eq(diningOrders.orderType, "takeout"), sql`NOT EXISTS (SELECT 1 FROM dining_kitchen_tickets WHERE order_id = ${ticket.orderId} AND status != 'served')`)));
    await db.batch(queries as any);
    return { success: true, status: params.newStatus };
  }

  static async refundTakeout(context: TenantContext, params: {orderId: string; reason: string}) {
    const permission = checkPermission(context, "admin");
    if (!permission.allowed) throw new Error(permission.message);
    if (!params.reason.trim() || params.reason.length > 500) throw new Error("請填寫退款原因");
    const db = getDb();
    const [record] = await db.select().from(diningBills).innerJoin(diningOrders, eq(diningOrders.id, diningBills.orderId)).where(and(eq(diningBills.organizationId, context.organizationId), eq(diningOrders.id, params.orderId), eq(diningOrders.orderType, "takeout"))).limit(1);
    if (!record || record.dining_bills.status !== "paid") throw new Error("外帶訂單不存在或已退款");
    const bill = record.dining_bills;
    const condition = sql`EXISTS (SELECT 1 FROM dining_bills WHERE id = ${bill.id} AND organization_id = ${context.organizationId} AND status = 'paid' AND paid_amount = ${bill.paidAmount})`;
    try {await db.batch([
      guard(context, condition, "DINING_TAKEOUT_REFUND", params.orderId, {refundAmount: bill.paidAmount}, params.reason),
      db.update(diningBills).set({paidAmount: 0, status: "refunded"}).where(eq(diningBills.id, bill.id)),
      db.insert(diningPayments).values({id: crypto.randomUUID(), organizationId: context.organizationId, billId: bill.id, amount: -bill.paidAmount, paymentMethod: "mock_refund", splitIndex: 1}),
      db.update(diningOrders).set({status: "cancelled"}).where(eq(diningOrders.id, params.orderId)),
      db.update(diningOrderItems).set({status: "cancelled", cancelledReason: params.reason}).where(eq(diningOrderItems.orderId, params.orderId)),
      db.update(diningKitchenTickets).set({status: "served"}).where(eq(diningKitchenTickets.orderId, params.orderId)),
    ]);} catch(error) {throw new Error("訂單已退款或狀態已變更，不會重複退款", {cause: error});}
    return {success: true, orderId: params.orderId, refundAmount: bill.paidAmount};
  }

  /**
   * D06: Cancel item before cooking or with supervisor authorization
   */
  static async cancelOrderItem(context: TenantContext, params: {
    orderItemId: string;
    reason: string;
  }) {
    writable(context);
    if (!params.reason.trim() || params.reason.length > 500) throw new Error("退菜必須填寫有效原因");
    const db = getDb();
    const items = await db.select().from(diningOrderItems)
      .where(and(
        eq(diningOrderItems.organizationId, context.organizationId),
        eq(diningOrderItems.id, params.orderItemId)
      ))
      .limit(1);

    if (items.length === 0) throw new Error("找不到該餐點明細");
    const item = items[0];
    if (item.status === "cancelled") throw new Error("餐點已退菜，不可重複操作");

    // If cooking or prepared, requires manager role (D06)
    if (item.status !== "pending") {
      const perm = checkPermission(context, "admin");
      if (!perm.allowed) {
        throw new Error("餐點已在製作中或已完成，退菜必須經主管授權 (D06)");
      }
    }

    await db.batch([
      guard(context, sql`EXISTS (SELECT 1 FROM dining_order_items i JOIN dining_orders o ON o.id = i.order_id JOIN dining_table_sessions s ON s.id = o.session_id WHERE i.id = ${item.id} AND i.organization_id = ${context.organizationId} AND i.status = ${item.status} AND s.status = 'active')`, "DINING_CANCEL", item.id, {status: "cancelled", previousStatus: item.status, amount: item.lineTotal}, params.reason),
      db.update(diningOrderItems).set({
      status: "cancelled",
      cancelledReason: params.reason,
    }).where(eq(diningOrderItems.id, params.orderItemId)),

    // Cancel matching kitchen ticket
    db.update(diningKitchenTickets).set({
      status: "served", // Mark inactive
    }).where(and(eq(diningKitchenTickets.orderItemId, params.orderItemId), eq(diningKitchenTickets.organizationId, context.organizationId)))]);

    return { success: true, cancelledItemId: params.orderItemId };
  }

  /**
   * D07: Split Bill & Payment with 10% Service Charge & anti-double-payment
   */
  static async splitAndPayBill(context: TenantContext, params: {
    sessionId: string;
    splits: Array<{ splitIndex: number; amount: number; paymentMethod?: string }>;
  }) {
    writable(context);
    if (!Array.isArray(params.splits) || !params.splits.length || params.splits.length > 20) throw new Error("請提供有效分單");
    for (const split of params.splits) {
      if (!Number.isSafeInteger(split.amount) || split.amount <= 0 || !Number.isSafeInteger(split.splitIndex) || split.splitIndex <= 0) throw new Error("分單金額與編號必須是正整數");
      if (split.paymentMethod && !["cash", "credit_card", "mock_card"].includes(split.paymentMethod)) throw new Error("不支援的付款方式");
    }
    if (new Set(params.splits.map(s => s.splitIndex)).size !== params.splits.length) throw new Error("分單編號不可重複");
    const db = getDb();
    const [session] = await db.select().from(diningTableSessions).where(and(eq(diningTableSessions.organizationId, context.organizationId), eq(diningTableSessions.id, params.sessionId))).limit(1);
    if (!session || session.status !== "active") throw new Error("桌次不存在或已結帳，不能重複支付");

    // Calculate all active orders for this session
    const orders = await db.select().from(diningOrders)
      .where(and(
        eq(diningOrders.organizationId, context.organizationId),
        eq(diningOrders.sessionId, params.sessionId),
        eq(diningOrders.status, "placed")
      ));

    let grossFoodTotal = 0;
    for (const o of orders) {
      // Fetch uncancelled items
      const items = await db.select().from(diningOrderItems)
        .where(and(eq(diningOrderItems.orderId, o.id)));
      for (const it of items) {
        if (it.status !== "cancelled") {
          grossFoodTotal += it.lineTotal;
        }
      }
    }

    const locRes = await db.select().from(diningLocations)
      .where(eq(diningLocations.organizationId, context.organizationId))
      .limit(1);
    const serviceRate = locRes[0]?.serviceFeeRate ?? 10;

    const calc = calculateDiningAmounts({
      subtotal: grossFoodTotal,
      serviceFeeRatePercent: serviceRate,
    });

    const splitSum = params.splits.reduce((sum, s) => sum + s.amount, 0);
    if (splitSum !== calc.finalAmount) {
      throw new Error(`分單合計金額 (${splitSum}) 必須等於帳單總金額 (${calc.finalAmount}) (D07)`);
    }

    const billId = `bill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const condition = sql`EXISTS (SELECT 1 FROM dining_table_sessions WHERE id = ${session.id} AND organization_id = ${context.organizationId} AND status = 'active') AND COALESCE((SELECT SUM(i.line_total) FROM dining_order_items i JOIN dining_orders o ON o.id = i.order_id WHERE o.organization_id = ${context.organizationId} AND o.session_id = ${session.id} AND o.status = 'placed' AND i.status != 'cancelled'), 0) = ${grossFoodTotal}`;
    const queries: any[] = [guard(context, condition, "DINING_PAYMENT", billId, {subtotal: calc.subtotal, finalAmount: calc.finalAmount, splits: params.splits})];
    queries.push(db.insert(diningBills).values({
      id: billId,
      organizationId: context.organizationId,
      sessionId: params.sessionId,
      subtotal: calc.subtotal,
      serviceCharge: calc.serviceCharge,
      discountAmount: calc.discountAmount,
      finalAmount: calc.finalAmount,
      paidAmount: calc.finalAmount,
      status: "paid",
    }));

    for (const s of params.splits) {
      queries.push(db.insert(diningPayments).values({
        id: `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        billId,
        amount: s.amount,
        paymentMethod: s.paymentMethod === "credit_card" ? "mock_card" : s.paymentMethod || "cash",
        splitIndex: s.splitIndex,
      }));
    }

    // Close session: Calculate actual dining duration (from QR scan / openedAt to checkout)
    const openedAtMs = session.openedAt ? new Date(session.openedAt).getTime() : Date.now() - 3600000;
    const closedAtDate = new Date();
    const durationMinutes = Math.max(1, Math.round((closedAtDate.getTime() - openedAtMs) / 60000));
    // Reserve 5 minutes for cleaning buffer: table is vacant but uncleared
    const cleanedUntil = new Date(closedAtDate.getTime() + 5 * 60 * 1000).toISOString();

    queries.push(db.update(diningTableSessions).set({
      status: "closed",
      closedAt: closedAtDate.toISOString(),
      durationMinutes: durationMinutes,
    }).where(and(eq(diningTableSessions.id, params.sessionId), eq(diningTableSessions.organizationId, context.organizationId))));

    // Release table to cleaning state (空桌 未清潔，預留5分鐘清潔時間)
    queries.push(db.update(diningTables).set({
      status: "cleaning",
      cleanedUntil: cleanedUntil,
    }).where(and(eq(diningTables.id, session.tableId), eq(diningTables.organizationId, context.organizationId))));
    queries.push(db.update(diningOrders).set({status: "completed"}).where(and(eq(diningOrders.sessionId, session.id), eq(diningOrders.organizationId, context.organizationId))));
    try {await db.batch(queries as any);} catch(error) {throw new Error("帳單已變更或已由其他人結帳，請重新整理，不會重複收款", {cause: error});}

    return {
      success: true,
      billId,
      subtotal: calc.subtotal,
      serviceCharge: calc.serviceCharge,
      finalAmount: calc.finalAmount,
      paidSplits: params.splits.length,
      durationMinutes,
      cleanedUntil,
    };
  }

  /**
   * Complete cleaning and make table available (vacant)
   */
  static async cleanTable(context: TenantContext, params: { tableId: string }) {
    writable(context);
    const db = getDb();
    const [table] = await db.select().from(diningTables)
      .where(and(eq(diningTables.organizationId, context.organizationId), eq(diningTables.id, params.tableId)))
      .limit(1);
    if (!table) throw new Error("桌位不存在");

    await db.update(diningTables).set({
      status: "vacant",
      cleanedUntil: null,
    }).where(and(eq(diningTables.organizationId, context.organizationId), eq(diningTables.id, params.tableId)));

    return { success: true, tableId: params.tableId, status: "vacant" };
  }

  /**
   * Seat a confirmed reservation: creates session and marks table occupied
   */
  static async seatReservation(context: TenantContext, params: { reservationId: string }) {
    writable(context);
    const db = getDb();
    const [reservation] = await db.select().from(diningReservations)
      .where(and(eq(diningReservations.organizationId, context.organizationId), eq(diningReservations.id, params.reservationId)))
      .limit(1);
    if (!reservation) throw new Error("預約資料不存在");
    if (reservation.status !== "confirmed") throw new Error("該預約非待入座狀態");

    const [table] = await db.select().from(diningTables)
      .where(and(eq(diningTables.organizationId, context.organizationId), eq(diningTables.id, reservation.tableId)))
      .limit(1);
    if (!table) throw new Error("指定桌位不存在");
    if (table.status === "occupied") throw new Error("指定桌位目前仍有用餐中的顧客，無法入座");

    const newSessionId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    await db.batch([
      db.update(diningReservations).set({ status: "seated" }).where(and(eq(diningReservations.organizationId, context.organizationId), eq(diningReservations.id, reservation.id))),
      db.insert(diningTableSessions).values({
        id: newSessionId,
        organizationId: context.organizationId,
        tableId: table.id,
        guestCount: reservation.guestCount,
        sessionToken,
        status: "active",
        openedAt: new Date().toISOString(),
      }),
      db.update(diningTables).set({ status: "occupied", cleanedUntil: null }).where(and(eq(diningTables.organizationId, context.organizationId), eq(diningTables.id, table.id))),
    ]);

    return { success: true, reservationId: reservation.id, sessionId: newSessionId, sessionToken };
  }

  /**
   * Cancel a reservation
   */
  static async cancelReservation(context: TenantContext, params: { reservationId: string }) {
    writable(context);
    const db = getDb();
    const [reservation] = await db.select().from(diningReservations)
      .where(and(eq(diningReservations.organizationId, context.organizationId), eq(diningReservations.id, params.reservationId)))
      .limit(1);
    if (!reservation) throw new Error("預約資料不存在");

    await db.update(diningReservations).set({ status: "cancelled" }).where(and(eq(diningReservations.organizationId, context.organizationId), eq(diningReservations.id, reservation.id)));

    return { success: true, reservationId: reservation.id, status: "cancelled" };
  }
}
