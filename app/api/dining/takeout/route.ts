import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { DiningService } from "@/lib/services/dining-service";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const permission = checkPermission(context, "operator");
    if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403, undefined, context.requestId);
    const input = z.object({items: z.array(z.object({menuItemId: z.string().min(1), quantity: z.number().int().positive().max(100), modifiers: z.array(z.object({groupId: z.string().min(1), optionId: z.string().min(1)})).max(20).optional()})).min(1).max(100), paymentMethod: z.enum(["cash", "mock_card"]), idempotencyKey: z.string().min(1).max(150)}).parse(await request.json());
    return successResponse(await DiningService.placeOrder(context, {...input, sessionToken: "", orderType: "takeout"}), context.requestId);
  } catch(error) {return errorResponse("TAKEOUT_FAILED", error instanceof Error ? error.message : "外帶結帳失敗", 400);}
}
