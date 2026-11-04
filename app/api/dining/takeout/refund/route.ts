import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { DiningService } from "@/lib/services/dining-service";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const permission = checkPermission(context, "admin");
    if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403, undefined, context.requestId);
    const input = z.object({orderId: z.string().min(1), reason: z.string().trim().min(1).max(500)}).parse(await request.json());
    return successResponse(await DiningService.refundTakeout(context, input), context.requestId);
  } catch(error) {return errorResponse("TAKEOUT_REFUND_FAILED", error instanceof Error ? error.message : "外帶退款失敗", 400);}
}
