import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { PosService } from "@/lib/services/pos-service";
import { getDb } from "@/db";
import { posShifts, posRegisters } from "@/db/schema";
import { eq, and } from "drizzle-orm";
const id = z.string().min(1).max(160);
const amount = z.number().int().nonnegative().max(100000000);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hold"), storeId: id, cartName: z.string().min(1).max(80), items: z.array(z.object({ barcode: id, quantity: z.number().int().positive().max(10000), lineDiscount: amount })).min(1).max(100) }),
  z.object({ action: z.literal("retrieve"), cartId: id }),
  z.object({ action: z.literal("close"), shiftId: id, closingCash: amount, notes: z.string().max(500).optional() }),
  z.object({ action: z.literal("open"), registerId: id, openingCash: amount }),
  z.object({ action: z.literal("receipt"), receiptNumber: id }),
  z.object({ action: z.literal("refund"), saleId: id, lineReturns: z.array(z.object({ lineId: id, quantity: z.number().int().positive() })).min(1), reason: z.string().trim().min(1).max(500) }),
]);
export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  try {
    const body = actionSchema.parse(await request.json());
    if (!checkPermission(context, body.action === "refund" ? "admin" : "operator").allowed) return errorResponse("FORBIDDEN", "目前示範角色無操作權限", 403, undefined, context.requestId);
    let result: unknown;
    switch (body.action) {
      case "hold": result = await PosService.holdCart(context, body); break;
      case "retrieve": result = await PosService.retrieveCart(context, body.cartId, context.userId); break;
      case "close": result = await PosService.closeShift(context, body); break;
      case "receipt": result = await PosService.reprintReceipt(context, body.receiptNumber); break;
      case "refund": result = await PosService.refundSale(context, body); break;
      case "open": {
        const db = getDb();
        const [register] = await db.select().from(posRegisters).where(and(eq(posRegisters.organizationId, context.organizationId), eq(posRegisters.id, body.registerId)));
        if (!register) throw new Error("收銀機不存在");
        const shiftId = crypto.randomUUID();
        await db.insert(posShifts).values({ id: shiftId, organizationId: context.organizationId, storeId: register.storeId, registerId: register.id, cashierId: context.userId, openingCash: body.openingCash, status: "open" });
        result = { shiftId, message: "開班成功" }; break;
      }
    }
    return successResponse(result, context.requestId);
  } catch (error: any) { return errorResponse("POS_ACTION_FAILED", error instanceof z.ZodError ? error.issues.map(issue => issue.message).join("；") : error.message, 400, undefined, context.requestId); }
}
