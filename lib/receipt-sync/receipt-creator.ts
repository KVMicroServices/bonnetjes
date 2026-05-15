import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueReceiptProcessing } from "@/lib/queue";
import type { ReviewDto } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const KV_SYNC_PATH_PREFIX = "kv-sync:";
const SYSTEM_USER_EMAIL = "system@receipt-sync.internal";
const DEFAULT_FILE_TYPE = "image";

// ─── Receipt Creator ──────────────────────────────────────────────────────────

export async function createReceiptFromSync(params: {
  review: ReviewDto;
  s3Key: string;
  fileSize: number;
  receiptAutoVerifyEnabled: boolean;
}): Promise<string> {
  const systemUserId = await getOrCreateSystemUserId();

  const cloudStoragePath = `${KV_SYNC_PATH_PREFIX}${params.s3Key}`;
  const originalFilename = params.s3Key;
  const fileType = inferFileType(params.s3Key);

  let processingStatus = "idle";
  if (params.receiptAutoVerifyEnabled) {
    processingStatus = "queued";
  }

  const receipt = await prisma.receipt.create({
    data: {
      userId: systemUserId,
      cloudStoragePath,
      originalFilename,
      fileType,
      fileSize: params.fileSize,
      verificationStatus: "pending",
      processingStatus,
      extractedShopName: params.review.shopName || null,
      extractedDate: parseReviewDate(params.review.reviewDate),
      extractedAmount: params.review.amount || null,
    },
  });

  // When auto-verify is enabled, enqueue for OCR + fraud detection processing
  if (params.receiptAutoVerifyEnabled) {
    await enqueueReceiptProcessing(receipt.id, systemUserId);
    logger.info(
      { receiptId: receipt.id, reviewId: params.review.reviewId },
      "Enqueued synced receipt for OCR processing"
    );
  }

  logger.info(
    { receiptId: receipt.id, reviewId: params.review.reviewId, autoVerify: params.receiptAutoVerifyEnabled },
    "Created receipt record from KV sync"
  );

  return receipt.id;
}

// ─── System User Management ───────────────────────────────────────────────────

let cachedSystemUserId: string | null = null;

async function getOrCreateSystemUserId(): Promise<string> {
  if (cachedSystemUserId) {
    return cachedSystemUserId;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: SYSTEM_USER_EMAIL },
  });

  if (existingUser) {
    cachedSystemUserId = existingUser.id;
    return existingUser.id;
  }

  const newUser = await prisma.user.create({
    data: {
      email: SYSTEM_USER_EMAIL,
      name: "Receipt Sync Service",
      role: "user",
    },
  });

  cachedSystemUserId = newUser.id;
  logger.info({ userId: newUser.id }, "Created system user for receipt sync");

  return newUser.id;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferFileType(s3Key: string): string {
  const lowerKey = s3Key.toLowerCase();

  if (lowerKey.endsWith(".pdf")) {
    return "pdf";
  }

  return DEFAULT_FILE_TYPE;
}

function parseReviewDate(dateString: string | null): Date | null {
  if (!dateString) {
    return null;
  }

  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}
