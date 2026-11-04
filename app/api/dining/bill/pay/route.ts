import { NextRequest } from "next/server";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { z } from "zod/v3";
import { getDb } from "@/db";
import { diningTableSessions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { successResponse, errorResponse } from "@/lib/api-response";
import { DiningService } from "@/lib/services/dining-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const permission = checkPermission(context, "operator");
    if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403);
    const body = z.object({sessionId: z.string().min(1), splits: z.array(z.object({splitIndex: z.number().int().positive(), amount: z.number().int().positive(), paymentMethod: z.enum(["cash", "mock_card"])})).min(1).max(20)}).parse(await request.json());
    if (new Set(body.splits.map(s => s.splitIndex)).size !== body.splits.length) throw new Error("分單編號不可重複");
    const [session] = await getDb().select().from(diningTableSessions).where(and(eq(diningTableSessions.id, body.sessionId), eq(diningTableSessions.organizationId, context.organizationId))).limit(1);
    if (!session || session.status !== "active") throw new Error("桌次不存在或已結帳，不能重複支付");

    const result = await DiningService.splitAndPayBill(context, {
      sessionId: body.sessionId,
      splits: body.splits,
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("PAY_BILL_FAILED", err.message, 400);
  }
}
