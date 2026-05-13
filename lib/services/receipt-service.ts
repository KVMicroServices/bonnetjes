import { PrismaClient } from "@prisma/client";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface StorageClient {
  getFileUrl(cloudStoragePath: string, isPublic: boolean): Promise<string>;
  getFileAsBuffer(cloudStoragePath: string): Promise<Buffer>;
}

export interface ReceiptServiceDependencies {
  database: PrismaClient;
  storage: StorageClient;
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface CreateReceiptInput {
  cloudStoragePath: string;
  isPublic?: boolean;
  originalFilename?: string;
  fileType?: string;
  fileSize?: number;
}

// ─── Result Types ────────────────────────────────────────────────────────────

export type ListReceiptsResult =
  | { success: true; receipts: ReadonlyArray<ReceiptWithUser> }
  | { success: false; error: string };

export type GetReceiptResult =
  | { success: true; receipt: ReceiptWithDetails }
  | { success: false; error: string; statusCode: number };

export type CreateReceiptResult =
  | { success: true; receipt: CreatedReceipt }
  | { success: false; error: string; statusCode: number };

export type UpdateReceiptStatusResult =
  | { success: true; receipt: UpdatedReceipt }
  | { success: false; error: string; statusCode: number };

export type ArchiveReceiptsResult =
  | { success: true; archivedCount: number }
  | { success: false; error: string; statusCode: number };

export type ListArchivedReceiptsResult =
  | { success: true; grouped: Record<string, ReadonlyArray<ArchivedReceipt>> }
  | { success: false; error: string };

export type GetDownloadUrlResult =
  | { success: true; downloadUrl: string; filename: string }
  | { success: false; error: string; statusCode: number };

// ─── Entity Types ────────────────────────────────────────────────────────────

interface ReceiptUser {
  id: string;
  name: string | null;
  email: string;
}

interface ReceiptWithUser {
  id: string;
  userId: string;
  cloudStoragePath: string;
  isPublic: boolean;
  originalFilename: string;
  fileType: string;
  fileSize: number;
  isArchived: boolean;
  archivedAt: Date | null;
  extractedShopName: string | null;
  extractedDate: Date | null;
  extractedAmount: number | null;
  ocrConfidence: number | null;
  ocrReasoning: string | null;
  receiptReadable: boolean | null;
  verificationStatus: string;
  imageHash: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  manipulationScore: number | null;
  manipulationFlags: string | null;
  suspiciousPatterns: string | null;
  fraudRiskScore: number | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
  user: ReceiptUser;
}

interface AdminActionWithAdmin {
  id: string;
  adminId: string;
  receiptId: string;
  action: string;
  notes: string | null;
  createdAt: Date;
  admin: ReceiptUser;
}

interface ReceiptWithDetails extends ReceiptWithUser {
  adminActions: ReadonlyArray<AdminActionWithAdmin>;
}

interface CreatedReceipt {
  id: string;
  userId: string;
  cloudStoragePath: string;
  isPublic: boolean;
  originalFilename: string;
  fileType: string;
  fileSize: number;
  verificationStatus: string;
  imageHash: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  manipulationScore: number | null;
  manipulationFlags: string | null;
  suspiciousPatterns: string | null;
  fraudRiskScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UpdatedReceipt {
  id: string;
  verificationStatus: string;
  processedAt: Date | null;
}

interface ArchivedReceipt {
  id: string;
  userId: string;
  originalFilename: string;
  archivedAt: Date | null;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  [key: string]: unknown;
}

// ─── Fraud Detection Types ───────────────────────────────────────────────────

interface FraudAnalysisResult {
  imageHash: string | null;
  isDuplicate: boolean;
  duplicateOfId: string | undefined;
  manipulationScore: number;
  manipulationFlags: string[];
  suspiciousPatterns: string[];
  patternRiskScore: number;
  fraudRiskScore: number;
}

export interface FraudDetectionModule {
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

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_OCR_CONFIDENCE = 100;
const UNKNOWN_DATE_KEY = "unknown";
const KV_SYNC_PATH_PREFIX = "kv-sync:";
const KV_PRESIGNED_URL_EXPIRY_SECONDS = 3600;

// ─── Service Functions ───────────────────────────────────────────────────────

/** Retrieve receipts filtered by user role. Admins see all, users see their own. */
export async function listReceipts(
  dependencies: ReceiptServiceDependencies,
  userId: string,
  isAdmin: boolean
): Promise<ListReceiptsResult> {
  const whereClause = isAdmin ? {} : { userId };

  const receipts = await dependencies.database.receipt.findMany({
    where: whereClause,
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return { success: true, receipts };
}

/** Retrieve a single receipt with access control. */
export async function getReceipt(
  dependencies: ReceiptServiceDependencies,
  receiptId: string,
  userId: string,
  isAdmin: boolean
): Promise<GetReceiptResult> {
  const receipt = await dependencies.database.receipt.findUnique({
    where: { id: receiptId },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      adminActions: {
        include: {
          admin: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!receipt) {
    return { success: false, error: "Receipt not found", statusCode: 404 };
  }

  if (!isAdmin && receipt.userId !== userId) {
    return { success: false, error: "Access denied", statusCode: 403 };
  }

  return { success: true, receipt };
}

/** Create a receipt with fraud detection pipeline. */
export async function createReceipt(
  dependencies: ReceiptServiceDependencies,
  userId: string,
  input: CreateReceiptInput,
  fraudDetection: FraudDetectionModule
): Promise<CreateReceiptResult> {
  if (!input.cloudStoragePath) {
    return {
      success: false,
      error: "Missing cloudStoragePath",
      statusCode: 400,
    };
  }

  const fraudAnalysis = await runFraudDetectionPipeline(
    dependencies,
    userId,
    input.cloudStoragePath,
    fraudDetection
  );

  const isPublic = input.isPublic === true ? true : false;
  const originalFilename = input.originalFilename ? input.originalFilename : "receipt";
  const fileType = input.fileType ? input.fileType : "image";
  const fileSize = input.fileSize ? input.fileSize : 0;

  const receipt = await dependencies.database.receipt.create({
    data: {
      userId,
      cloudStoragePath: input.cloudStoragePath,
      isPublic,
      originalFilename,
      fileType,
      fileSize,
      verificationStatus: "pending",
      imageHash: fraudAnalysis.imageHash,
      isDuplicate: fraudAnalysis.isDuplicate,
      duplicateOfId: fraudAnalysis.duplicateOfId,
      manipulationScore: fraudAnalysis.manipulationScore,
      manipulationFlags: JSON.stringify(fraudAnalysis.manipulationFlags),
      suspiciousPatterns: JSON.stringify(fraudAnalysis.suspiciousPatterns),
      fraudRiskScore: fraudAnalysis.fraudRiskScore,
    },
  });

  return { success: true, receipt };
}

/** Update receipt verification status (admin only) and log the action. */
export async function updateReceiptStatus(
  dependencies: ReceiptServiceDependencies,
  receiptId: string,
  adminId: string,
  status: string,
  notes: string | undefined
): Promise<UpdateReceiptStatusResult> {
  const receipt = await dependencies.database.receipt.update({
    where: { id: receiptId },
    data: {
      verificationStatus: status,
      processedAt: new Date(),
    },
  });

  await dependencies.database.adminAction.create({
    data: {
      adminId,
      receiptId,
      action: status,
      notes,
    },
  });

  return { success: true, receipt };
}

/** Archive multiple receipts. Non-admins can only archive their own. */
export async function archiveReceipts(
  dependencies: ReceiptServiceDependencies,
  receiptIds: ReadonlyArray<string>,
  userId: string,
  isAdmin: boolean
): Promise<ArchiveReceiptsResult> {
  if (!receiptIds || !Array.isArray(receiptIds)) {
    return {
      success: false,
      error: "Receipt IDs required",
      statusCode: 400,
    };
  }

  const updateFilter: Record<string, unknown> = {
    id: { in: receiptIds },
    isArchived: false,
  };

  if (!isAdmin) {
    updateFilter.userId = userId;
  }

  const result = await dependencies.database.receipt.updateMany({
    where: updateFilter as any,
    data: {
      isArchived: true,
      archivedAt: new Date(),
    },
  });

  return { success: true, archivedCount: result.count };
}

/** List archived receipts grouped by archive date. */
export async function listArchivedReceipts(
  dependencies: ReceiptServiceDependencies,
  userId: string,
  isAdmin: boolean
): Promise<ListArchivedReceiptsResult> {
  const whereClause: Record<string, unknown> = { isArchived: true };

  if (!isAdmin) {
    whereClause.userId = userId;
  }

  const receipts = await dependencies.database.receipt.findMany({
    where: whereClause as any,
    include: { user: true },
    orderBy: { archivedAt: "desc" },
  });

  const grouped: Record<string, ArchivedReceipt[]> = {};

  for (const receipt of receipts) {
    let dateKey: string;
    if (receipt.archivedAt) {
      dateKey = receipt.archivedAt.toISOString().split("T")[0];
    } else {
      dateKey = UNKNOWN_DATE_KEY;
    }

    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(receipt as unknown as ArchivedReceipt);
  }

  return { success: true, grouped };
}

/** Generate a signed download URL for a receipt file. Logs admin downloads. */
export async function getDownloadUrl(
  dependencies: ReceiptServiceDependencies,
  receiptId: string,
  userId: string,
  isAdmin: boolean
): Promise<GetDownloadUrlResult> {
  const receipt = await dependencies.database.receipt.findUnique({
    where: { id: receiptId },
  });

  if (!receipt) {
    return { success: false, error: "Receipt not found", statusCode: 404 };
  }

  if (!isAdmin && receipt.userId !== userId) {
    return { success: false, error: "Access denied", statusCode: 403 };
  }

  if (isAdmin) {
    await dependencies.database.adminAction.create({
      data: {
        adminId: userId,
        receiptId,
        action: "download",
      },
    });
  }

  // Handle KV-synced receipts (stored in external S3 bucket, not R2)
  if (receipt.cloudStoragePath.startsWith(KV_SYNC_PATH_PREFIX)) {
    const s3Key = receipt.cloudStoragePath.substring(KV_SYNC_PATH_PREFIX.length);
    const downloadUrl = await getKvSyncDownloadUrl(s3Key);
    if (!downloadUrl) {
      return { success: false, error: "KV S3 bucket not configured", statusCode: 503 };
    }
    return {
      success: true,
      downloadUrl,
      filename: receipt.originalFilename,
    };
  }

  const downloadUrl = await dependencies.storage.getFileUrl(
    receipt.cloudStoragePath,
    receipt.isPublic
  );

  return {
    success: true,
    downloadUrl,
    filename: receipt.originalFilename,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function getKvSyncDownloadUrl(s3Key: string): Promise<string | null> {
  const { loadSyncConfiguration } = await import("@/lib/receipt-sync/config");
  const { KvS3Client } = await import("@/lib/receipt-sync/kv-s3-client");

  const configuration = loadSyncConfiguration();
  if (!configuration || configuration.kvReceiptS3BucketName.length === 0) {
    return null;
  }

  const kvS3Client = new KvS3Client(configuration);
  const url = await kvS3Client.getPresignedDownloadUrl(s3Key, KV_PRESIGNED_URL_EXPIRY_SECONDS);
  return url;
}

async function runFraudDetectionPipeline(
  dependencies: ReceiptServiceDependencies,
  userId: string,
  cloudStoragePath: string,
  fraudDetection: FraudDetectionModule
): Promise<FraudAnalysisResult> {
  let imageHash: string | null = null;
  let isDuplicate = false;
  let duplicateOfId: string | undefined = undefined;
  let manipulationScore = 0;
  let manipulationFlags: string[] = [];
  let suspiciousPatterns: string[] = [];
  let patternRiskScore = 0;

  try {
    const fileBuffer = await dependencies.storage.getFileAsBuffer(cloudStoragePath);

    imageHash = fraudDetection.calculateImageHash(fileBuffer);

    const duplicateCheck = await fraudDetection.checkForDuplicates(imageHash, userId);
    isDuplicate = duplicateCheck.isDuplicate;
    duplicateOfId = duplicateCheck.duplicateOfId;

    const metadataAnalysis = fraudDetection.analyzeMetadata(fileBuffer);
    manipulationScore = metadataAnalysis.manipulationScore;
    manipulationFlags = metadataAnalysis.flags;

    const patternAnalysis = await fraudDetection.detectSuspiciousPatterns(
      userId,
      null,
      null
    );
    suspiciousPatterns = patternAnalysis.patterns;
    patternRiskScore = patternAnalysis.riskScore;
  } catch {
    // Fraud detection failure is non-fatal; proceed with defaults
  }

  const fraudRiskScore = fraudDetection.calculateFraudRiskScore(
    isDuplicate,
    manipulationScore,
    patternRiskScore,
    DEFAULT_OCR_CONFIDENCE
  );

  return {
    imageHash,
    isDuplicate,
    duplicateOfId,
    manipulationScore,
    manipulationFlags,
    suspiciousPatterns,
    patternRiskScore,
    fraudRiskScore,
  };
}
