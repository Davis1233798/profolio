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
    const body = z.object({ticketId: z.string().min(1), newStatus: z.enum(["cooking", "done", "served"])}).parse(await request.json());

    const result = await DiningService.updateKdsTicketStatus(context, {
      ticketId: body.ticketId,
      newStatus: body.newStatus,
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("KDS_UPDATE_FAILED", err.message, 400);
  }
}
