import { NextRequest } from "next/server";
import { z } from "zod/v3";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { DiningService } from "@/lib/services/dining-service";

export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  const permission = checkPermission(context, "operator");
  if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403, undefined, context.requestId);
  try {
    const input = z.object({tableId: z.string().min(1), customerName: z.string().trim().min(1).max(100), customerPhone: z.string().trim().min(3).max(30), guestCount: z.number().int().positive().max(100), reservationTime: z.string().datetime({offset: true})}).parse(await request.json());
    return successResponse(await DiningService.reserveTable(context, input), context.requestId);
  } catch (error) { return errorResponse("RESERVATION_FAILED", error instanceof Error ? error.message : "預約失敗", 400, undefined, context.requestId); }
}
