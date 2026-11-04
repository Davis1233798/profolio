import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { DiningService } from "@/lib/services/dining-service";
import { getDb } from "@/db";
import { diningOrderItems, diningOrders, diningTableSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  const permission = checkPermission(context, "operator");
  if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403);
  try {
    const input = z.object({orderItemId: z.string().min(1), reason: z.string().trim().min(1).max(500)}).parse(await request.json());
    const db = getDb();
    const [record] = await db.select({status: diningTableSessions.status, itemStatus: diningOrderItems.status}).from(diningOrderItems).innerJoin(diningOrders, eq(diningOrders.id, diningOrderItems.orderId)).innerJoin(diningTableSessions, eq(diningTableSessions.id, diningOrders.sessionId)).where(and(eq(diningOrderItems.organizationId, context.organizationId), eq(diningOrderItems.id, input.orderItemId))).limit(1);
    if (!record || record.status !== "active" || record.itemStatus === "cancelled") throw new Error("已結帳或已退菜，無法再次退菜");
    return successResponse(await DiningService.cancelOrderItem(context, input), context.requestId);
  } catch(error) { return errorResponse("CANCEL_FAILED", error instanceof Error ? error.message : "退菜失敗", 400, undefined, context.requestId); }
}
