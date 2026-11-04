import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v3";
import { getDb } from "@/db";
import { diningTables, diningTableSessions, auditEvents } from "@/db/schema";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  const permission = checkPermission(context, "operator");
  if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403, undefined, context.requestId);
  try {
    const input = z.object({tableId: z.string().min(1), guestCount: z.number().int().positive().max(100)}).parse(await request.json());
    const db = getDb();
    const [table] = await db.select().from(diningTables).where(and(eq(diningTables.id, input.tableId), eq(diningTables.organizationId, context.organizationId))).limit(1);
    if (!table || table.status !== "vacant") throw new Error("桌位不存在或尚未空桌");
    if (input.guestCount > table.capacity) throw new Error("用餐人數超過桌位容量");
    const session = {id: crypto.randomUUID(), organizationId: context.organizationId, tableId: table.id, guestCount: input.guestCount, sessionToken: crypto.randomUUID(), status: "active"};
    // The NOT NULL audit actor guard aborts the entire batch if another request
    // claimed this table; neither a partial session nor an occupied table remains.
    await db.batch([
      db.insert(auditEvents).values({id: crypto.randomUUID(), organizationId: context.organizationId, actorId: sql`CASE WHEN EXISTS (SELECT 1 FROM dining_tables WHERE id = ${table.id} AND organization_id = ${context.organizationId} AND status = 'vacant') THEN ${context.userId} ELSE NULL END`, actorRole: context.role, action: "DINING_OPEN_TABLE", entityType: "dining", entityId: session.id, afterValue: JSON.stringify({tableId: table.id, guestCount: input.guestCount}), requestId: context.requestId}),
      db.insert(diningTableSessions).values(session),
      db.update(diningTables).set({status: "occupied"}).where(and(eq(diningTables.id, table.id), eq(diningTables.organizationId, context.organizationId))),
    ]);
    const [created] = await db.select().from(diningTableSessions).where(eq(diningTableSessions.id, session.id));
    if (!created) throw new Error("桌位已由其他人開桌，請重新整理");
    return successResponse(created, context.requestId);
  } catch (error) { return errorResponse("OPEN_TABLE_FAILED", error instanceof Error ? error.message : "開桌失敗", 400, undefined, context.requestId); }
}

import { sql } from "drizzle-orm";
