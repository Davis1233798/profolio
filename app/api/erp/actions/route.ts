import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ErpAdvancedService as S } from "@/lib/services/erp-advanced-service";
import { ErpService } from "@/lib/services/erp-service";
const id = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(500);
const qty = z.number().int().nonnegative().max(10000000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)), "日期無效");
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("partner"), kind: z.enum(["supplier", "customer"]), code: id, name: text, contactEmail: z.string().email().optional() }),
  z.object({ action: z.literal("invoice"), kind: z.enum(["payable", "receivable"]), orderId: id, dueDate: date.optional() }),
  z.object({ action: z.literal("count"), itemId: id, warehouseId: id, expectedQuantity: qty, countedQuantity: qty, reason: text, approved: z.literal(true) }),
  z.object({ action: z.literal("return"), receiptLineId: id, quantity: qty.positive(), reason: text }),
  z.object({ action: z.literal("closePeriod"), periodId: id }),
  z.object({ action: z.literal("journal"), entryDate: date, description: text, lines: z.array(z.object({ accountCode: id, accountName: text, debitAmount: qty, creditAmount: qty })).min(2).max(100) }),
]);
export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  try {
    const body = schema.parse(await request.json());
    if (!checkPermission(context, body.action === "count" || body.action === "closePeriod" ? "admin" : "operator").allowed) return errorResponse("FORBIDDEN", "目前示範角色無操作權限", 403, undefined, context.requestId);
    const result = body.action === "partner" ? await S.partner(context, body) : body.action === "invoice" ? await S.invoice(context, body) : body.action === "count" ? await S.count(context, body) : body.action === "return" ? await S.supplierReturn(context, body) : body.action === "closePeriod" ? await S.closePeriod(context, body.periodId) : await ErpService.createJournalEntry(context, body);
    return successResponse(result, context.requestId);
  } catch (error: any) { return errorResponse("ERP_ACTION_FAILED", error instanceof z.ZodError ? error.issues.map(issue => issue.message).join("；") : error.message, 400, undefined, context.requestId); }
}
