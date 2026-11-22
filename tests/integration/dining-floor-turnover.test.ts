import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../../db/index.ts";
import { diningTables, diningTableSessions, diningReservations } from "../../db/schema.ts";
import { seedOrganization } from "../../lib/seed.ts";
import { DiningService } from "../../lib/services/dining-service.ts";
import { eq, and } from "drizzle-orm";

test("Dining: checkout marks table as cleaning with 5-minute buffer and calculates duration", async () => {
  const orgId = `org_din_clean_${Date.now()}`;
  await seedOrganization(orgId);
  const db = getDb();

  const staffCtx = {
    organizationId: orgId,
    userId: "usr_waiter",
    userEmail: "waiter@test.local",
    userDisplayName: "Waiter",
    role: "operator" as const,
    requestId: "req_clean_test",
  };

  // Find active session on A2
  const [sessionA2] = await db.select().from(diningTableSessions).where(and(eq(diningTableSessions.organizationId, orgId), eq(diningTableSessions.status, "active"))).limit(1);
  assert.ok(sessionA2);

  // Pay bill
  const payRes = await DiningService.splitAndPayBill(staffCtx, {
    sessionId: sessionA2.id,
    splits: [{ splitIndex: 1, amount: 330, paymentMethod: "cash" }],
  });

  assert.equal(payRes.success, true);
  assert.ok(payRes.durationMinutes && payRes.durationMinutes >= 1);
  assert.ok(payRes.cleanedUntil);

  // Verify table is in cleaning status
  const [tableA2] = await db.select().from(diningTables).where(and(eq(diningTables.organizationId, orgId), eq(diningTables.id, sessionA2.tableId))).limit(1);
  assert.equal(tableA2.status, "cleaning");
  assert.ok(tableA2.cleanedUntil);

  // Verify staff can manually mark cleaned
  const cleanRes = await DiningService.cleanTable(staffCtx, { tableId: tableA2.id });
  assert.equal(cleanRes.status, "vacant");

  const [tableCleaned] = await db.select().from(diningTables).where(and(eq(diningTables.organizationId, orgId), eq(diningTables.id, sessionA2.tableId))).limit(1);
  assert.equal(tableCleaned.status, "vacant");
  assert.equal(tableCleaned.cleanedUntil, null);
});

test("Dining: reservation lifecycle and seating into active table", async () => {
  const orgId = `org_din_res_${Date.now()}`;
  await seedOrganization(orgId);
  const db = getDb();

  const staffCtx = {
    organizationId: orgId,
    userId: "usr_waiter",
    userEmail: "waiter@test.local",
    userDisplayName: "Waiter",
    role: "operator" as const,
    requestId: "req_res_test",
  };

  const [tableB1] = await db.select().from(diningTables).where(and(eq(diningTables.organizationId, orgId), eq(diningTables.tableNumber, "B1"))).limit(1);
  assert.ok(tableB1);

  // 1. Create reservation
  const res = await DiningService.reserveTable(staffCtx, {
    tableId: tableB1.id,
    customerName: "王小明",
    customerPhone: "0912-345-678",
    guestCount: 2,
    reservationTime: "2026-11-25T18:00:00Z",
  });
  assert.ok(res.reservationId);

  // 2. Seat reservation
  const seatRes = await DiningService.seatReservation(staffCtx, { reservationId: res.reservationId });
  assert.equal(seatRes.success, true);

  // Check table occupied
  const [seatedTable] = await db.select().from(diningTables).where(eq(diningTables.id, tableB1.id));
  assert.equal(seatedTable.status, "occupied");

  // Check session created
  const [seatedSession] = await db.select().from(diningTableSessions).where(eq(diningTableSessions.id, seatRes.sessionId));
  assert.equal(seatedSession.status, "active");
  assert.equal(seatedSession.guestCount, 2);
});
