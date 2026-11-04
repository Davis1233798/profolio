import { NextRequest } from "next/server";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { z } from "zod/v3";
import { successResponse, errorResponse } from "@/lib/api-response";
import { DiningService } from "@/lib/services/dining-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const permission = checkPermission(context, "operator");
    if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403);
    const body = z.object({sessionToken: z.string().min(1), items: z.array(z.object({menuItemId: z.string().min(1), quantity: z.number().int().positive().max(100), modifiers: z.array(z.object({groupId: z.string().min(1), optionId: z.string().min(1)})).max(20).optional()})).min(1).max(100), idempotencyKey: z.string().min(1).max(150)}).parse(await request.json());

    const result = await DiningService.placeOrder(context, {
      sessionToken: body.sessionToken,
      items: body.items,
      idempotencyKey: body.idempotencyKey,
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("PLACE_ORDER_FAILED", err.message, 400);
  }
}
