import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import {
  organizations,
  demoSeedStates,
  users,
  memberships,
  mesProducts,
  mesBomVersions,
  mesBomItems,
  mesWorkCenters,
  mesWorkOrders,
  mesOperations,
  mesMaterialLots,
  mesWorkOrderMaterials,
  erpWarehouses,
  erpItems,
  erpSuppliers,
  erpCustomers,
  erpPurchaseOrders,
  erpPurchaseOrderLines,
  erpSalesOrders,
  erpSalesOrderLines,
  erpStockLedger,
  erpItemCosting,
  erpInvoices,
  erpJournalEntries,
  erpJournalLines,
  erpFiscalPeriods,
  posStores,
  posRegisters,
  posShifts,
  posCatalogItems,
  crmAccounts,
  crmContacts,
  crmLeads,
  crmStages,
  crmOpportunities,
  crmActivities,
  crmQuotes,
  crmQuoteItems,
  crmTickets,
  crmConsents,
  diningLocations,
  diningTables,
  diningMenuItems,
  diningModifierGroups,
  diningModifierOptions,
  diningTableSessions,
  diningOrders,
  diningOrderItems,
  diningKitchenTickets,
  shopCategories,
  shopProducts,
  shopVariants,
  shopPromotions,
  shopOrders,
  shopOrderItems,
} from "../db/schema";

// Fictional fixtures only: no real brands, personal phone numbers or delivery addresses.
export async function seedOrganization(orgId: string = "org_demo_default") {
  const db = getDb();

  // 1. Organization & Core Users
  const existingOrg = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (existingOrg.length === 0) {
    await db.insert(organizations).values({
      id: orgId,
      name: "示範企業 (Business Suite Enterprise)",
      slug: orgId,
    }).onConflictDoNothing();
  }

  // Users
  const adminUser = { id: `usr_${orgId}_admin`, email: "admin@suite.test", displayName: "示範管理員 (Admin)" };
  const operatorUser = { id: `usr_${orgId}_op`, email: "operator@suite.test", displayName: "示範作業員 / 現場主管" };
  const readonlyUser = { id: `usr_${orgId}_ro`, email: "guest@suite.test", displayName: "訪客 (唯讀)" };

  for (const u of [adminUser, operatorUser, readonlyUser]) {
    const exists = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (exists.length === 0) {
      await db.insert(users).values(u).onConflictDoNothing();
    }
  }

  // Memberships
  const memberRoles = [
    { userId: adminUser.id, role: "admin" },
    { userId: operatorUser.id, role: "operator" },
    { userId: readonlyUser.id, role: "readonly" },
  ];
  for (const m of memberRoles) {
    const memId = `mem_${orgId}_${m.userId}`;
    const exists = await db.select().from(memberships).where(eq(memberships.id, memId)).limit(1);
    if (exists.length === 0) {
      await db.insert(memberships).values({
        id: memId,
        organizationId: orgId,
        userId: m.userId,
        role: m.role,
      }).onConflictDoNothing();
    }
  }

  // ==========================================
  // 2. MES「ForgeFlow」Seed
  // ==========================================
  const prd1 = {
    id: `mes_prd_01_${orgId}`,
    organizationId: orgId,
    sku: "PRD-AL-HEAT",
    name: "鋁合金散熱模組 (Alloy Heat Module A)",
    unit: "PCS",
    status: "active",
  };
  await db.insert(mesProducts).values(prd1).onConflictDoNothing();

  const bom1 = {
    id: `mes_bom_v1_${orgId}`,
    organizationId: orgId,
    productId: prd1.id,
    version: 1,
    status: "active",
    isActive: true,
    notes: "標準生產BOM v1 (每件耗原鋁2件、散熱膏1管)",
  };
  await db.insert(mesBomVersions).values(bom1).onConflictDoNothing();

  await db.insert(mesBomItems).values([
    {
      id: `mes_item_01_${orgId}`,
      organizationId: orgId,
      bomVersionId: bom1.id,
      materialSku: "RAW-ALUM-6061",
      materialName: "航太級6061原鋁塊",
      quantityPerUnit: 2, // 2 pieces per PRD-A
      unit: "PCS",
    },
    {
      id: `mes_item_02_${orgId}`,
      organizationId: orgId,
      bomVersionId: bom1.id,
      materialSku: "RAW-THERMAL-PASTE",
      materialName: "高效能導熱膏",
      quantityPerUnit: 1,
      unit: "TUBE",
    },
  ]).onConflictDoNothing();

  const wc1 = {
    id: `mes_wc_01_${orgId}`,
    organizationId: orgId,
    code: "WC-CNC-01",
    name: "精密五軸CNC切削中心",
    capacityMinutesPerDay: 480, // 8 hours
    status: "active",
  };
  const wc2 = {
    id: `mes_wc_02_${orgId}`,
    organizationId: orgId,
    code: "WC-ANODIZE-01",
    name: "陽極氧化表面處理線",
    capacityMinutesPerDay: 480,
    status: "active",
  };
  await db.insert(mesWorkCenters).values([wc1, wc2]).onConflictDoNothing();

  // Material lots
  const lot1 = {
    id: `mes_lot_01_${orgId}`,
    organizationId: orgId,
    lotNumber: "LOT-202610-AL01",
    materialSku: "RAW-ALUM-6061",
    initialQuantity: 500,
    currentQuantity: 300,
    status: "available",
  };
  await db.insert(mesMaterialLots).values(lot1).onConflictDoNothing();

  // Work Order 100
  const wo1 = {
    id: `mes_wo_01_${orgId}`,
    organizationId: orgId,
    orderNo: "WO-202610-001",
    productId: prd1.id,
    bomVersionId: bom1.id,
    targetQuantity: 100,
    completedQuantity: 0,
    scrappedQuantity: 0,
    status: "released",
    materialsStaged: true,
    scheduledMinutes: 480,
  };
  await db.insert(mesWorkOrders).values(wo1).onConflictDoNothing();

  await db.insert(mesOperations).values([
    {
      id: `mes_op_01_${orgId}`,
      organizationId: orgId,
      workOrderId: wo1.id,
      sequence: 10,
      workCenterId: wc1.id,
      name: "精密CNC切削成型",
      standardMinutesPerUnit: 1,
      status: "pending",
    },
    {
      id: `mes_op_02_${orgId}`,
      organizationId: orgId,
      workOrderId: wo1.id,
      sequence: 20,
      workCenterId: wc2.id,
      name: "陽極硬化處理",
      standardMinutesPerUnit: 1,
      status: "pending",
    },
  ]).onConflictDoNothing();

  await db.insert(mesWorkOrderMaterials).values({
    id: `mes_wom_01_${orgId}`,
    organizationId: orgId,
    workOrderId: wo1.id,
    materialLotId: lot1.id,
    materialSku: "RAW-ALUM-6061",
    issuedQuantity: 200,
    returnedQuantity: 10,
    netQuantity: 190,
  }).onConflictDoNothing();

  // ==========================================
  // 3. ERP「LedgerWorks」Seed
  // ==========================================
  const whMain = { id: `erp_wh_01_${orgId}`, organizationId: orgId, code: "WH-TP", name: "台北總倉", isActive: true };
  const whSec = { id: `erp_wh_02_${orgId}`, organizationId: orgId, code: "WH-TC", name: "台中轉運倉", isActive: true };
  await db.insert(erpWarehouses).values([whMain, whSec]).onConflictDoNothing();

  const itemWidget = {
    id: `erp_item_01_${orgId}`,
    organizationId: orgId,
    sku: "SKU-SENS-01",
    name: "工業級溫濕度傳感器 (單件)",
    unit: "PCS",
    boxConversionRatio: 1,
    category: "電子元件",
    isActive: true,
  };
  const itemBox = {
    id: `erp_item_02_${orgId}`,
    organizationId: orgId,
    sku: "SKU-SENS-BOX10",
    name: "工業級溫濕度傳感器 (十入盒裝)",
    unit: "BOX",
    boxConversionRatio: 10, // 1 box = 10 pcs
    category: "箱裝成品",
    isActive: true,
  };
  await db.insert(erpItems).values([itemWidget, itemBox]).onConflictDoNothing();

  const sup1 = { id: `erp_sup_01_${orgId}`, organizationId: orgId, code: "SUP-DEMO-01", name: "示範供應商 A（虛構）", contactEmail: "sales@supplier-a.example.test", isActive: true };
  const cust1 = { id: `erp_cust_01_${orgId}`, organizationId: orgId, code: "CUST-DEMO-01", name: "示範企業客戶 A（虛構）", contactEmail: "procure@customer-a.example.test", isActive: true };
  await db.insert(erpSuppliers).values(sup1).onConflictDoNothing();
  await db.insert(erpCustomers).values(cust1).onConflictDoNothing();

  // Costing & stock ledger: 10 @ 100 then 10 @ 200 = 20 @ 150
  await db.insert(erpItemCosting).values({
    id: `erp_cost_01_${orgId}`,
    organizationId: orgId,
    itemId: itemWidget.id,
    totalQuantity: 20,
    totalCost: 3000,
    movingAverageCost: 150,
  }).onConflictDoNothing();

  await db.insert(erpStockLedger).values([
    {
      id: `erp_stk_01_${orgId}`,
      organizationId: orgId,
      itemId: itemWidget.id,
      warehouseId: whMain.id,
      changeType: "purchase_receipt",
      quantityChange: 10,
      balanceAfter: 10,
      unitCost: 100,
      totalValue: 1000,
      referenceDoc: "PO-202610-001",
    },
    {
      id: `erp_stk_02_${orgId}`,
      organizationId: orgId,
      itemId: itemWidget.id,
      warehouseId: whMain.id,
      changeType: "purchase_receipt",
      quantityChange: 10,
      balanceAfter: 20,
      unitCost: 200,
      totalValue: 3000,
      referenceDoc: "PO-202610-002",
    },
  ]).onConflictDoNothing();

  // PO & SO
  const po1 = {
    id: `erp_po_01_${orgId}`,
    organizationId: orgId,
    poNumber: "PO-202610-001",
    supplierId: sup1.id,
    status: "approved",
    totalAmount: 1000, // 10 * 100
  };
  await db.insert(erpPurchaseOrders).values(po1).onConflictDoNothing();
  await db.insert(erpPurchaseOrderLines).values({
    id: `erp_pol_01_${orgId}`,
    organizationId: orgId,
    poId: po1.id,
    itemId: itemWidget.id,
    quantity: 10,
    unitPrice: 100,
    receivedQuantity: 10,
  }).onConflictDoNothing();

  const so1 = {
    id: `erp_so_01_${orgId}`,
    organizationId: orgId,
    soNumber: "SO-202610-001",
    customerId: cust1.id,
    quoteReference: "QT-2026-001",
    status: "confirmed",
    totalAmount: 1500, // 5 * 300
  };
  await db.insert(erpSalesOrders).values(so1).onConflictDoNothing();
  await db.insert(erpSalesOrderLines).values({
    id: `erp_sol_01_${orgId}`,
    organizationId: orgId,
    soId: so1.id,
    itemId: itemWidget.id,
    quantity: 5,
    unitPrice: 300,
    shippedQuantity: 0,
  }).onConflictDoNothing();

  // Fiscal period
  await db.insert(erpFiscalPeriods).values({
    id: `erp_fp_202610_${orgId}`,
    organizationId: orgId,
    periodCode: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    isClosed: false,
  }).onConflictDoNothing();

  // Invoice with partial payment: 1000, paid 400, unpaid 600
  await db.insert(erpInvoices).values({
    id: `erp_inv_01_${orgId}`,
    organizationId: orgId,
    invoiceNumber: "INV-202610-001",
    invoiceType: "payable",
    partnerType: "supplier",
    partnerId: sup1.id,
    totalAmount: 1000,
    paidAmount: 400,
    status: "partially_paid",
    dueDate: "2026-11-15",
  }).onConflictDoNothing();

  // Balanced Journal Entry
  const je1 = {
    id: `erp_je_01_${orgId}`,
    organizationId: orgId,
    entryNumber: "JE-202610-001",
    entryDate: "2026-10-15",
    description: "期初股本與銀行存款開帳",
    referenceDoc: "INITIAL_CAPITAL",
    status: "posted",
  };
  await db.insert(erpJournalEntries).values(je1).onConflictDoNothing();
  await db.insert(erpJournalLines).values([
    {
      id: `erp_jel_01_${orgId}`,
      organizationId: orgId,
      journalId: je1.id,
      accountCode: "1101",
      accountName: "銀行存款 (Bank Deposit)",
      debitAmount: 100000,
      creditAmount: 0,
    },
    {
      id: `erp_jel_02_${orgId}`,
      organizationId: orgId,
      journalId: je1.id,
      accountCode: "3101",
      accountName: "普通股股本 (Common Stock)",
      debitAmount: 0,
      creditAmount: 100000,
    },
  ]).onConflictDoNothing();

  // ==========================================
  // 4. POS「CounterPoint」Seed
  // ==========================================
  const store1 = { id: `pos_store_01_${orgId}`, organizationId: orgId, code: "STORE-XY", name: "示範門市 A（虛構）", address: "示範地址 A（非實際地址）" };
  await db.insert(posStores).values(store1).onConflictDoNothing();

  const reg1 = { id: `pos_reg_01_${orgId}`, organizationId: orgId, storeId: store1.id, registerNumber: "REG-01", name: "1號收銀櫃檯", isActive: true };
  await db.insert(posRegisters).values(reg1).onConflictDoNothing();

  await db.insert(posShifts).values({
    id: `pos_shift_01_${orgId}`,
    organizationId: orgId,
    storeId: store1.id,
    registerId: reg1.id,
    cashierId: operatorUser.id,
    openingCash: 1000, // 1000 cash float
    status: "open",
  }).onConflictDoNothing();

  await db.insert(posCatalogItems).values([
    { id: `pos_item_01_${orgId}`, organizationId: orgId, barcode: "4710001001", name: "精品冷萃美式咖啡 (大杯)", price: 100, stockQuantity: 100, isActive: true },
    { id: `pos_item_02_${orgId}`, organizationId: orgId, barcode: "4710001002", name: "手作黑糖肉桂捲", price: 90, stockQuantity: 50, isActive: true },
    { id: `pos_item_03_${orgId}`, organizationId: orgId, barcode: "4710001003", name: "衣索比亞莊園濾掛禮盒", price: 350, stockQuantity: 20, isActive: true },
  ]).onConflictDoNothing();

  // ==========================================
  // 5. CRM「RelationDesk」Seed
  // ==========================================
  const stages = [
    { id: `crm_stg_01_${orgId}`, organizationId: orgId, name: "初步接觸", position: 1, probability: 10, isWon: false, isLost: false },
    { id: `crm_stg_02_${orgId}`, organizationId: orgId, name: "需求確認", position: 2, probability: 30, isWon: false, isLost: false },
    { id: `crm_stg_03_${orgId}`, organizationId: orgId, name: "方案報價", position: 3, probability: 60, isWon: false, isLost: false },
    { id: `crm_stg_04_${orgId}`, organizationId: orgId, name: "商務談判", position: 4, probability: 80, isWon: false, isLost: false },
    { id: `crm_stg_05_${orgId}`, organizationId: orgId, name: "成功結案", position: 5, probability: 100, isWon: true, isLost: false },
    { id: `crm_stg_06_${orgId}`, organizationId: orgId, name: "結案失單", position: 6, probability: 0, isWon: false, isLost: true },
  ];
  await db.insert(crmStages).values(stages).onConflictDoNothing();

  const acc1 = { id: `crm_acc_01_${orgId}`, organizationId: orgId, name: "示範雲端客戶 A（虛構）", industry: "雲端軟體", phone: "DEMO-PHONE-001", email: "contact@customer-a.example.test", ownerId: adminUser.id };
  await db.insert(crmAccounts).values(acc1).onConflictDoNothing();

  const cont1 = { id: `crm_cont_01_${orgId}`, organizationId: orgId, accountId: acc1.id, name: "示範聯絡人 A", email: "person-a@customer-a.example.test", phone: "DEMO-PHONE-002", title: "雲端架構處長" };
  await db.insert(crmContacts).values(cont1).onConflictDoNothing();

  await db.insert(crmConsents).values({
    id: `crm_csnt_01_${orgId}`,
    organizationId: orgId,
    contactId: cont1.id,
    email: cont1.email,
    marketingEmailAllowed: true,
  }).onConflictDoNothing();

  await db.insert(crmLeads).values({
    id: `crm_lead_01_${orgId}`,
    organizationId: orgId,
    name: "示範聯絡人 B",
    company: "示範製造潛客 B（虛構）",
    email: "person-b@prospect-b.example.test",
    phone: "DEMO-PHONE-003",
    status: "new",
    assignedTo: adminUser.id,
  }).onConflictDoNothing();

  // Opportunity: $100,000 at 60% probability = $60,000 weighted
  const opp1 = {
    id: `crm_opp_01_${orgId}`,
    organizationId: orgId,
    name: "智慧製造數位雙生升級案",
    accountId: acc1.id,
    primaryContactId: cont1.id,
    ownerId: adminUser.id,
    stageId: `crm_stg_03_${orgId}`,
    amount: 100000,
    weightedAmount: 60000,
    probability: 60,
    closeDate: "2026-11-30",
    status: "open",
  };
  await db.insert(crmOpportunities).values(opp1).onConflictDoNothing();

  const quote1 = {
    id: `crm_qt_01_${orgId}`,
    organizationId: orgId,
    quoteNumber: "QT-202610-001",
    opportunityId: opp1.id,
    version: 1,
    totalAmount: 100000,
    status: "approved",
    isLocked: true,
    approvedAt: "2026-10-25 10:00:00",
  };
  await db.insert(crmQuotes).values(quote1).onConflictDoNothing();
  await db.insert(crmQuoteItems).values({
    id: `crm_qti_01_${orgId}`,
    organizationId: orgId,
    quoteId: quote1.id,
    itemName: "數位雙生現場架設與授權 (年度)",
    quantity: 1,
    unitPrice: 100000,
    lineTotal: 100000,
  }).onConflictDoNothing();

  await db.insert(crmActivities).values({
    id: `crm_act_01_${orgId}`,
    organizationId: orgId,
    activityType: "meeting",
    subject: "客戶方案需求第二階段審核會議",
    dueDate: "2026-11-05 14:00",
    completed: false,
    ownerId: adminUser.id,
    accountId: acc1.id,
    contactId: cont1.id,
    opportunityId: opp1.id,
  }).onConflictDoNothing();

  await db.insert(crmTickets).values({
    id: `crm_tck_01_${orgId}`,
    organizationId: orgId,
    ticketNumber: "TCK-202610-001",
    customerId: acc1.id,
    contactId: cont1.id,
    subject: "API 對接金鑰權限授權配置詢問",
    priority: "high",
    status: "in_progress",
    slaHours: 24,
    isSlaBreached: false,
  }).onConflictDoNothing();

  // ==========================================
  // 6. Dining「TableCraft」Seed
  // ==========================================
  const loc1 = { id: `din_loc_01_${orgId}`, organizationId: orgId, name: "TableCraft 示範餐廳 A", serviceFeeRate: 10 };
  await db.insert(diningLocations).values(loc1).onConflictDoNothing();

  const tblA1 = { id: `din_tbl_a1_${orgId}`, organizationId: orgId, locationId: loc1.id, tableNumber: "A1", capacity: 4, status: "vacant" };
  const tblA2 = { id: `din_tbl_a2_${orgId}`, organizationId: orgId, locationId: loc1.id, tableNumber: "A2", capacity: 4, status: "occupied" };
  const tblB1 = { id: `din_tbl_b1_${orgId}`, organizationId: orgId, locationId: loc1.id, tableNumber: "B1", capacity: 2, status: "vacant" };
  await db.insert(diningTables).values([tblA1, tblA2, tblB1]).onConflictDoNothing();

  const steak = { id: `din_menu_01_${orgId}`, organizationId: orgId, name: "炭烤特級肋眼牛排", category: "排餐", price: 450, isSoldOut: false, station: "hot_kitchen" };
  const pasta = { id: `din_menu_02_${orgId}`, organizationId: orgId, name: "松露黑醋牛肝菌燉飯", category: "主食", price: 320, isSoldOut: false, station: "hot_kitchen" };
  const milktea = { id: `din_menu_03_${orgId}`, organizationId: orgId, name: "手熬黑糖珍珠鮮奶", category: "飲品", price: 100, isSoldOut: false, station: "cold_bar" };
  const soldOutItem = { id: `din_menu_04_${orgId}`, organizationId: orgId, name: "限量法式主廚威靈頓牛排", category: "限定", price: 680, isSoldOut: true, station: "hot_kitchen" };
  await db.insert(diningMenuItems).values([steak, pasta, milktea, soldOutItem]).onConflictDoNothing();

  // Modifiers
  const modGroupSweet = { id: `din_modg_01_${orgId}`, organizationId: orgId, name: "甜度 (必選)", minSelection: 1, maxSelection: 1, isRequired: true };
  const modGroupTopping = { id: `din_modg_02_${orgId}`, organizationId: orgId, name: "加料升級", minSelection: 0, maxSelection: 3, isRequired: false };
  await db.insert(diningModifierGroups).values([modGroupSweet, modGroupTopping]).onConflictDoNothing();

  await db.insert(diningModifierOptions).values([
    { id: `din_modo_01_${orgId}`, organizationId: orgId, groupId: modGroupSweet.id, name: "無糖 (0分)", additionalPrice: 0 },
    { id: `din_modo_02_${orgId}`, organizationId: orgId, groupId: modGroupSweet.id, name: "微糖 (3分)", additionalPrice: 0 },
    { id: `din_modo_03_${orgId}`, organizationId: orgId, groupId: modGroupSweet.id, name: "正常糖 (全糖)", additionalPrice: 0 },
    { id: `din_modo_04_${orgId}`, organizationId: orgId, groupId: modGroupTopping.id, name: "雙份手工黑糖珍珠", additionalPrice: 10 },
    { id: `din_modo_05_${orgId}`, organizationId: orgId, groupId: modGroupTopping.id, name: "日式特濃奶蓋", additionalPrice: 20 },
  ]).onConflictDoNothing();

  // Active Session on Table A2 with QR token
  const sessionA2 = {
    id: `din_sess_a2_${orgId}`,
    organizationId: orgId,
    tableId: tblA2.id,
    sessionToken: `token_tbl_a2_${orgId}`,
    guestCount: 2,
    status: "active",
  };
  await db.insert(diningTableSessions).values(sessionA2).onConflictDoNothing();

  // Sample order: 100 + 200 = 300, service 30 = 330
  const orderA2 = {
    id: `din_ord_01_${orgId}`,
    organizationId: orgId,
    sessionId: sessionA2.id,
    orderType: "dine_in",
    subtotal: 300,
    serviceCharge: 30,
    totalAmount: 330,
    status: "placed",
  };
  await db.insert(diningOrders).values(orderA2).onConflictDoNothing();

  const ordItem1 = {
    id: `din_oi_01_${orgId}`,
    organizationId: orgId,
    orderId: orderA2.id,
    menuItemId: milktea.id,
    itemName: "手熬黑糖珍珠鮮奶",
    unitPrice: 100,
    quantity: 1,
    modifiersJson: JSON.stringify([{ name: "微糖 (3分)" }]),
    lineTotal: 100,
    status: "preparing",
  };
  const ordItem2 = {
    id: `din_oi_02_${orgId}`,
    organizationId: orgId,
    orderId: orderA2.id,
    menuItemId: pasta.id,
    itemName: "松露黑醋牛肝菌燉飯 (前菜分享版)",
    unitPrice: 200,
    quantity: 1,
    modifiersJson: null,
    lineTotal: 200,
    status: "preparing",
  };
  await db.insert(diningOrderItems).values([ordItem1, ordItem2]).onConflictDoNothing();

  await db.insert(diningKitchenTickets).values([
    {
      id: `din_kt_01_${orgId}`,
      organizationId: orgId,
      orderId: orderA2.id,
      orderItemId: ordItem1.id,
      station: "cold_bar",
      itemName: ordItem1.itemName,
      quantity: 1,
      modifiersText: "微糖 (3分)",
      status: "received",
      urgentFlag: false,
    },
    {
      id: `din_kt_02_${orgId}`,
      organizationId: orgId,
      orderId: orderA2.id,
      orderItemId: ordItem2.id,
      station: "hot_kitchen",
      itemName: ordItem2.itemName,
      quantity: 1,
      modifiersText: "",
      status: "received",
      urgentFlag: false,
    },
  ]).onConflictDoNothing();

  // ==========================================
  // 7. Commerce「MarketLane」Seed
  // ==========================================
  const catApparel = { id: `shop_cat_01_${orgId}`, organizationId: orgId, name: "極簡機能服飾", slug: "apparel" };
  const catAccessory = { id: `shop_cat_02_${orgId}`, organizationId: orgId, name: "都市生活配件", slug: "accessories" };
  await db.insert(shopCategories).values([catApparel, catAccessory]).onConflictDoNothing();

  const prodHoodie = {
    id: `shop_prd_01_${orgId}`,
    organizationId: orgId,
    name: "極簡防風連帽機能外套",
    slug: "minimalist-tech-hoodie",
    description: "採用防潑水三層透氣微孔科技面料，適合都會通勤與戶外輕機能穿搭。",
    categoryId: catApparel.id,
    isActive: true,
  };
  await db.insert(shopProducts).values(prodHoodie).onConflictDoNothing();

  const varBlackM = {
    id: `shop_var_01_${orgId}`,
    organizationId: orgId,
    productId: prodHoodie.id,
    sku: "ML-HD-BLK-M",
    title: "曜石黑 / M",
    color: "曜石黑",
    size: "M",
    price: 100, // $100 for easy test calculations matching S04 fixture
    stockQuantity: 20,
    reservedQuantity: 0,
    isActive: true,
  };
  const varBlackL = {
    id: `shop_var_02_${orgId}`,
    organizationId: orgId,
    productId: prodHoodie.id,
    sku: "ML-HD-BLK-L",
    title: "曜石黑 / L",
    color: "曜石黑",
    size: "L",
    price: 100,
    stockQuantity: 1, // Only 1 in stock for concurrency anti-oversell testing!
    reservedQuantity: 0,
    isActive: true,
  };
  await db.insert(shopVariants).values([varBlackM, varBlackL]).onConflictDoNothing();

  // Promotion: 10% off
  await db.insert(shopPromotions).values([
    {
      id: `shop_promo_01_${orgId}`,
      organizationId: orgId,
      code: "SAVE10",
      description: "秋季全站 9 折優惠券",
      discountType: "percentage",
      discountValue: 10,
      minSpend: 0,
      isActive: true,
    },
    {
      id: `shop_promo_02_${orgId}`,
      organizationId: orgId,
      code: "EXPIRED50",
      description: "已過期優惠券",
      discountType: "fixed",
      discountValue: 50,
      minSpend: 200,
      expiresAt: "2020-01-01 00:00:00",
      isActive: false,
    },
  ]).onConflictDoNothing();

  // Completed order
  const order1 = {
    id: `shop_ord_01_${orgId}`,
    organizationId: orgId,
    orderNumber: "ORD-202610-001",
    customerEmail: "buyer@sites.test",
    shippingAddressJson: JSON.stringify({ name: "示範收件人 A", city: "台北市", address: "示範路段 A（非實際地址）", phone: "DEMO-PHONE-004" }),
    subtotal: 200,
    discountAmount: 20,
    shippingFee: 60,
    totalAmount: 240,
    paymentStatus: "paid",
    fulfillmentStatus: "shipped",
    trackingNumber: "TRK-TW-888999",
  };
  await db.insert(shopOrders).values(order1).onConflictDoNothing();
  await db.insert(shopOrderItems).values({
    id: `shop_oi_01_${orgId}`,
    organizationId: orgId,
    orderId: order1.id,
    variantId: varBlackM.id,
    productName: prodHoodie.name,
    variantTitle: varBlackM.title,
    sku: varBlackM.sku,
    unitPrice: 100,
    quantity: 2,
    lineTotal: 180,
  }).onConflictDoNothing();

  await db.insert(demoSeedStates).values({ organizationId: orgId }).onConflictDoNothing();
  return { success: true, organizationId: orgId };
}
