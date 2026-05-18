import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import type { DisputeTokenPayload } from "@/lib/dispute/dispute-token";

// ─── Constants ───────────────────────────────────────────────────────────────

const DISPUTE_USER_EMAIL = "disputes@receipt-sync.internal";
const DISPUTE_USER_NAME = "Dispute Submissions";
const DEFAULT_FILE_TYPE = "image";
const ALLOWED_CONTENT_TYPES: ReadonlyArray<string> = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];
const MAX_FILE_NAME_LENGTH = 200;

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface DisputeStorageClient {
  generateDisputePresignedUploadUrl(
    reviewId: string,
    fileName: string,
    contentType: string
  ): Promise<{ uploadUrl: string; cloud_storage_path: string }>;
  getFileAsBuffer(cloudStoragePath: string): Promise<Buffer>;
}

export interface DisputeFraudDetection {
  calculateImageHash(imageBuffer: Buffer): string;
  checkForDuplicates(
    imageHash: string,
    userId: string,
    excludeReceiptId?: string
  ): Promise<{ isDuplicate: boolean; duplicateOfId?: string }>;
  analyzeMetadata(fileBuffer: Buffer): {
    manipulationScore: number;
    flags: string[];
  };
  detectSuspiciousPatterns(
    userId: string,
    shopName: string | null | undefined,
    amount: number | null | undefined
  ): Promise<{ patterns: string[]; riskScore: number }>;
  calculateFraudRiskScore(
    isDuplicate: boolean,
    manipulationScore: number,
    patternRiskScore: number,
    ocrConfidence?: number
  ): number;
}

export interface DisputeServiceDependencies {
  database: PrismaClient;
  storage: DisputeStorageClient;
  fraudDetection: DisputeFraudDetection;
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface PresignDisputeUploadInput {
  payload: DisputeTokenPayload;
  fileName: string;
  contentType: string;
}

export interface VerifyDisputeInput {
  payload: DisputeTokenPayload;
  cloudStoragePath: string;
  originalFilename: string;
  fileType: string;
  fileSize: number;
}

export interface RequestHumanReviewInput {
  payload: DisputeTokenPayload;
  receiptId: string;
}

// ─── Results ─────────────────────────────────────────────────────────────────

export type PresignDisputeUploadResult =
  | {
      success: true;
      uploadUrl: string;
      cloudStoragePath: string;
    }
  | { success: false; error: string; statusCode: number };

export interface VerifyDisputeReceiptSummary {
  id: string;
  verificationStatus: string;
  failureReason: string | null;
  extractedShopName: string | null;
  extractedDate: string | null;
  extractedAmount: number | null;
  ocrConfidence: number | null;
  ocrReasoning: string | null;
  secondaryAnalysis: string | null;
}

export type VerifyDisputeResult =
  | { success: true; receipt: VerifyDisputeReceiptSummary }
  | { success: false; error: string; statusCode: number };

export type RequestHumanReviewResult =
  | { success: true; receiptId: string; verificationStatus: string }
  | { success: false; error: string; statusCode: number };

// ─── OCR Pipeline Adapter ────────────────────────────────────────────────────

export interface DisputeOcrAdapter {
  buildMessages(
    fileBuffer: Buffer,
    fileType: string,
    originalFilename: string
  ): Promise<unknown>;
  runOcr(
    messages: unknown
  ): Promise<{
    extractedShopName: string | null;
    extractedDate: Date | null;
    extractedAmount: number | null;
    receiptReadable: boolean;
    confidence: number;
    reasoning: string;
    failureReason: string | null;
  }>;
  decideStatus(
    parsed: {
      extractedShopName: string | null;
      extractedDate: Date | null;
      extractedAmount: number | null;
      receiptReadable: boolean;
      confidence: number;
      reasoning: string;
      failureReason: string | null;
    },
    isDuplicate: boolean
  ): {
    status: string;
    failureReason: string | null;
    isDateTooOld: boolean;
    dateValidationMessage: string;
  };
  runSecondary(
    messages: unknown,
    parsed: {
      extractedShopName: string | null;
      extractedDate: Date | null;
      extractedAmount: number | null;
      receiptReadable: boolean;
      confidence: number;
      reasoning: string;
      failureReason: string | null;
    },
    failureReason: string
  ): Promise<string>;
}

// ─── Service Functions ───────────────────────────────────────────────────────

/** Validate a presign request and return a Cloudflare R2 upload URL scoped to the dispute. */
export async function presignDisputeUpload(
  dependencies: Pick<DisputeServiceDependencies, "storage">,
  input: PresignDisputeUploadInput
): Promise<PresignDisputeUploadResult> {
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName) {
    return { success: false, error: "Missing fileName", statusCode: 400 };
  }

  if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
    return { success: false, error: "Unsupported file type", statusCode: 400 };
  }

  const presigned = await dependencies.storage.generateDisputePresignedUploadUrl(
    input.payload.reviewId,
    fileName,
    input.contentType
  );

  return {
    success: true,
    uploadUrl: presigned.uploadUrl,
    cloudStoragePath: presigned.cloud_storage_path,
  };
}

/**
 * Run live verification on a freshly uploaded dispute receipt and persist a Receipt + ReceiptDispute row.
 * Returns the receipt summary including verification status. Failures still create records
 * so the user can request human review.
 */
export async function verifyDisputeReceipt(
  dependencies: DisputeServiceDependencies,
  ocr: DisputeOcrAdapter,
  input: VerifyDisputeInput
): Promise<VerifyDisputeResult> {
  if (!input.cloudStoragePath) {
    return { success: false, error: "Missing cloudStoragePath", statusCode: 400 };
  }

  const disputeUserId = await getOrCreateDisputeUserId(dependencies.database);

  const fileBuffer = await dependencies.storage.getFileAsBuffer(input.cloudStoragePath);

  const fraudAnalysis = await runFraudPipeline(dependencies, fileBuffer, disputeUserId);

  const fileType = input.fileType || DEFAULT_FILE_TYPE;
  const originalFilename = input.originalFilename || "dispute-receipt";

  const messages = await ocr.buildMessages(fileBuffer, fileType, originalFilename);
  const parsed = await ocr.runOcr(messages);
  const decision = ocr.decideStatus(parsed, fraudAnalysis.isDuplicate);

  let secondaryAnalysis: string | null = null;
  if (decision.status === "rejected" && decision.failureReason) {
    try {
      secondaryAnalysis = await ocr.runSecondary(messages, parsed, decision.failureReason);
    } catch (error) {
      logger.warn(
        { error, reviewId: input.payload.reviewId },
        "Dispute secondary analysis failed"
      );
    }
  }

  const patternAnalysis = await dependencies.fraudDetection.detectSuspiciousPatterns(
    disputeUserId,
    parsed.extractedShopName,
    parsed.extractedAmount
  );

  const finalFraudRiskScore = dependencies.fraudDetection.calculateFraudRiskScore(
    fraudAnalysis.isDuplicate,
    fraudAnalysis.manipulationScore,
    patternAnalysis.riskScore,
    parsed.confidence
  );

  let ocrReasoning = parsed.reasoning;
  if (decision.isDateTooOld) {
    ocrReasoning = `${parsed.reasoning} | ${decision.dateValidationMessage}`;
  }

  const reasoningWithDispute = appendDisputeMarker(ocrReasoning, input.payload.reviewId);

  const receipt = await dependencies.database.receipt.create({
    data: {
      userId: disputeUserId,
      cloudStoragePath: input.cloudStoragePath,
      isPublic: false,
      originalFilename,
      fileType,
      fileSize: input.fileSize || 0,
      verificationStatus: decision.status,
      processingStatus: "completed",
      processedAt: new Date(),
      extractedShopName: parsed.extractedShopName,
      extractedDate: parsed.extractedDate,
      extractedAmount: parsed.extractedAmount,
      ocrConfidence: parsed.confidence,
      ocrReasoning: reasoningWithDispute,
      receiptReadable: parsed.receiptReadable,
      failureReason: decision.failureReason,
      secondaryAnalysis,
      imageHash: fraudAnalysis.imageHash,
      isDuplicate: fraudAnalysis.isDuplicate,
      duplicateOfId: fraudAnalysis.duplicateOfId,
      manipulationScore: fraudAnalysis.manipulationScore,
      manipulationFlags: JSON.stringify(fraudAnalysis.manipulationFlags),
      suspiciousPatterns: JSON.stringify(patternAnalysis.patterns),
      fraudRiskScore: finalFraudRiskScore,
    },
  });

  await dependencies.database.receiptDispute.create({
    data: {
      reviewId: input.payload.reviewId,
      tenantId: input.payload.tenantId,
      locationId: input.payload.locationId,
      receiptId: receipt.id,
      status: decision.status,
      failureReason: decision.failureReason,
    },
  });

  let extractedDateString: string | null = null;
  if (parsed.extractedDate) {
    extractedDateString = parsed.extractedDate.toISOString().split("T")[0];
  }

  logger.info(
    {
      receiptId: receipt.id,
      reviewId: input.payload.reviewId,
      verificationStatus: decision.status,
      failureReason: decision.failureReason,
    },
    "Dispute receipt verified"
  );

  return {
    success: true,
    receipt: {
      id: receipt.id,
      verificationStatus: decision.status,
      failureReason: decision.failureReason,
      extractedShopName: parsed.extractedShopName,
      extractedDate: extractedDateString,
      extractedAmount: parsed.extractedAmount,
      ocrConfidence: parsed.confidence,
      ocrReasoning,
      secondaryAnalysis,
    },
  };
}

/** Mark a dispute receipt as needing human review. The token's reviewId must match the dispute record. */
export async function requestHumanReview(
  dependencies: Pick<DisputeServiceDependencies, "database">,
  input: RequestHumanReviewInput
): Promise<RequestHumanReviewResult> {
  if (!input.receiptId) {
    return { success: false, error: "Missing receiptId", statusCode: 400 };
  }

  const dispute = await dependencies.database.receiptDispute.findFirst({
    where: { receiptId: input.receiptId, reviewId: input.payload.reviewId },
    select: { id: true },
  });

  if (!dispute) {
    return {
      success: false,
      error: "Dispute record not found for this token",
      statusCode: 404,
    };
  }

  const existing = await dependencies.database.receipt.findUnique({
    where: { id: input.receiptId },
    select: { id: true, ocrReasoning: true },
  });

  if (!existing) {
    return { success: false, error: "Receipt not found", statusCode: 404 };
  }

  let updatedReasoning: string;
  if (existing.ocrReasoning) {
    updatedReasoning = `${existing.ocrReasoning} | human_review_requested`;
  } else {
    updatedReasoning = "human_review_requested";
  }

  const [updated] = await dependencies.database.$transaction([
    dependencies.database.receipt.update({
      where: { id: input.receiptId },
      data: {
        verificationStatus: "requires_review",
        ocrReasoning: updatedReasoning,
        processedAt: new Date(),
      },
      select: { id: true, verificationStatus: true },
    }),
    dependencies.database.receiptDispute.update({
      where: { id: dispute.id },
      data: { status: "requires_review" },
    }),
  ]);

  logger.info({ receiptId: updated.id }, "Dispute receipt flagged for human review");

  return {
    success: true,
    receiptId: updated.id,
    verificationStatus: updated.verificationStatus,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

interface FraudPipelineResult {
  imageHash: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | undefined;
  manipulationScore: number;
  manipulationFlags: ReadonlyArray<string>;
}

async function runFraudPipeline(
  dependencies: DisputeServiceDependencies,
  fileBuffer: Buffer,
  userId: string
): Promise<FraudPipelineResult> {
  let imageHash: string | null = null;
  let isDuplicate = false;
  let duplicateOfId: string | undefined = undefined;
  let manipulationScore = 0;
  let manipulationFlags: string[] = [];

  try {
    imageHash = dependencies.fraudDetection.calculateImageHash(fileBuffer);
    const duplicateCheck = await dependencies.fraudDetection.checkForDuplicates(imageHash, userId);
    isDuplicate = duplicateCheck.isDuplicate;
    duplicateOfId = duplicateCheck.duplicateOfId;

    const metadataAnalysis = dependencies.fraudDetection.analyzeMetadata(fileBuffer);
    manipulationScore = metadataAnalysis.manipulationScore;
    manipulationFlags = metadataAnalysis.flags;
  } catch (error) {
    logger.warn({ error }, "Dispute fraud pipeline failed; using defaults");
  }

  return {
    imageHash,
    isDuplicate,
    duplicateOfId,
    manipulationScore,
    manipulationFlags,
  };
}

let cachedDisputeUserId: string | null = null;

async function getOrCreateDisputeUserId(database: PrismaClient): Promise<string> {
  if (cachedDisputeUserId) {
    return cachedDisputeUserId;
  }

  const existing = await database.user.findUnique({
    where: { email: DISPUTE_USER_EMAIL },
  });

  if (existing) {
    cachedDisputeUserId = existing.id;
    return existing.id;
  }

  const created = await database.user.create({
    data: {
      email: DISPUTE_USER_EMAIL,
      name: DISPUTE_USER_NAME,
      role: "user",
    },
  });

  cachedDisputeUserId = created.id;
  logger.info({ userId: created.id }, "Created dispute submissions system user");

  return created.id;
}

function sanitizeFileName(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FILE_NAME_LENGTH) {
    return null;
  }

  return trimmed;
}

function appendDisputeMarker(reasoning: string | null, reviewId: string): string {
  const marker = `dispute_for_review:${reviewId}`;
  if (!reasoning) {
    return marker;
  }
  return `${reasoning} | ${marker}`;
}
