export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  disableReviewByReceiptId,
  enableReviewByReceiptId,
  disableReviewManual,
} from "@/lib/review-disable/review-disable-service";

const disableByReceiptSchema = z.object({
  action: z.literal("disable"),
  receiptId: z.string().min(1),
});

const enableByReceiptSchema = z.object({
  action: z.literal("enable"),
  receiptId: z.string().min(1),
});

const disableManualSchema = z.object({
  action: z.literal("disable-manual"),
  reviewId: z.string().min(1),
  locationId: z.string().min(1),
  tenantId: z.number().int().positive(),
});

const requestSchema = z.discriminatedUnion("action", [
  disableByReceiptSchema,
  enableByReceiptSchema,
  disableManualSchema,
]);

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    logger.info({ action: data.action, data }, "Disable route handling action");

    if (data.action === "disable") {
      const result = await disableReviewByReceiptId(data.receiptId);
      logger.info({ result, receiptId: data.receiptId }, "disableReviewByReceiptId result");
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 404 });
      }
      return NextResponse.json({ success: true, reviewId: result.reviewId });
    }

    if (data.action === "enable") {
      const result = await enableReviewByReceiptId(data.receiptId);
      logger.info({ result, receiptId: data.receiptId }, "enableReviewByReceiptId result");
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 404 });
      }
      return NextResponse.json({ success: true, reviewId: result.reviewId });
    }

    if (data.action === "disable-manual") {
      const result = await disableReviewManual(data.reviewId, data.locationId, data.tenantId);
      logger.info({ result, reviewId: data.reviewId }, "disableReviewManual result");
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error({ error: message, stack }, "Disable route caught unhandled error");
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
