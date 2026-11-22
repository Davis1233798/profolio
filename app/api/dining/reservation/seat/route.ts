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
    const input = z.object({ reservationId: z.string().min(1) }).parse(await request.json());
    return successResponse(await DiningService.seatReservation(context, input), context.requestId);
  } catch (error) {
    return errorResponse("SEAT_RESERVATION_FAILED", error instanceof Error ? error.message : "預約入座失敗", 400, undefined, context.requestId);
  }
}
