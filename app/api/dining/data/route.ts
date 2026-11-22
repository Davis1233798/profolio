import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getDb } from "@/db/index";
import { eq, sql, and } from "drizzle-orm";
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
} from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const db = getDb();
    const orgId = context.organizationId;

    // Auto-release tables whose 5-minute cleaning period has expired
    const nowIso = new Date().toISOString();
    await db.update(diningTables)
      .set({ status: "vacant", cleanedUntil: null })
      .where(and(
        eq(diningTables.organizationId, orgId),
        eq(diningTables.status, "cleaning"),
        sql`cleaned_until IS NOT NULL AND julianday(cleaned_until) <= julianday(${nowIso})`
      ));

    const [locations, tables, reservations, menuItems, modifierGroups, modifierOptions, sessions, orders, kdsTickets, orderItems, bills, payments] =
      await Promise.all([
        db.select().from(diningLocations).where(eq(diningLocations.organizationId, orgId)),
        db.select().from(diningTables).where(eq(diningTables.organizationId, orgId)),
        db.select().from(diningReservations).where(eq(diningReservations.organizationId, orgId)),
        db.select().from(diningMenuItems).where(eq(diningMenuItems.organizationId, orgId)),
        db.select().from(diningModifierGroups).where(eq(diningModifierGroups.organizationId, orgId)),
        db.select().from(diningModifierOptions).where(eq(diningModifierOptions.organizationId, orgId)),
        db.select().from(diningTableSessions).where(eq(diningTableSessions.organizationId, orgId)),
        db.select().from(diningOrders).where(eq(diningOrders.organizationId, orgId)),
        db.select().from(diningKitchenTickets).where(eq(diningKitchenTickets.organizationId, orgId)).orderBy(sql`rowid DESC`),
        db.select().from(diningOrderItems).where(eq(diningOrderItems.organizationId, orgId)),
        db.select().from(diningBills).where(eq(diningBills.organizationId, orgId)),
        db.select().from(diningPayments).where(eq(diningPayments.organizationId, orgId)),
      ]);

    return successResponse({
      locations,
      tables,
      reservations,
      menuItems,
      modifierGroups,
      modifierOptions,
      sessions,
      orders,
      kdsTickets,
      orderItems,
      bills,
      payments,
    }, context.requestId);
  } catch (err: any) {
    return errorResponse("FETCH_DINING_FAILED", err.message, 500);
  }
}
