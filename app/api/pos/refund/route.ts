import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { PosService } from "@/lib/services/pos-service";
const schema = z.object({ saleId: z.string().min(1), lineReturns: z.array(z.object({ lineId: z.string().min(1), quantity: z.number().int().positive() })).min(1), reason: z.string().trim().min(1).max(500) });
export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  if (!checkPermission(context, "admin").allowed) return errorResponse("FORBIDDEN", "退款需要店長權限", 403, undefined, context.requestId);
  try { return successResponse(await PosService.refundSale(context, schema.parse(await request.json())), context.requestId); }
  catch (error: any) { return errorResponse("REFUND_FAILED", error instanceof z.ZodError ? "請檢查退貨數量與原因" : error.message, 400, undefined, context.requestId); }
}
