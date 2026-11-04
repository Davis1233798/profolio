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
    const input = z.object({ticketId: z.string().min(1)}).parse(await request.json());
    return successResponse(await DiningService.urgeKitchenTicket(context, input), context.requestId);
  } catch(error) {return errorResponse("URGE_FAILED", error instanceof Error ? error.message : "催單失敗", 400);}
}
