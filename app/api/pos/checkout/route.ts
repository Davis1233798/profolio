import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { PosService } from "@/lib/services/pos-service";
const schema = z.object({ storeId: z.string().min(1), registerId: z.string().min(1), shiftId: z.string().min(1), items: z.array(z.object({ barcode: z.string().min(1).max(100), quantity: z.number().int().positive().max(10000), lineDiscount: z.number().int().nonnegative().optional() })).min(1).max(100), tenderAmount: z.number().int().nonnegative(), paymentMethod: z.enum(["cash"]).default("cash"), idempotencyKey: z.string().min(1).max(160) });
export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  if (!checkPermission(context, "operator").allowed) { await request.arrayBuffer(); return errorResponse("FORBIDDEN", "唯讀角色無法收銀", 403, undefined, context.requestId); }
  try { return successResponse(await PosService.checkout(context, schema.parse(await request.json())), context.requestId); }
  catch (error: any) { return errorResponse("CHECKOUT_FAILED", error instanceof z.ZodError ? "請檢查購物籃、實收金額及班別欄位" : error.message, 400, undefined, context.requestId); }
}
