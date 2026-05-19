// ─── Dependencies ────────────────────────────────────────────────────────────

export interface StorageClient {
  generatePresignedUploadUrl(
    fileName: string,
    contentType: string,
    isPublic: boolean
  ): Promise<{ uploadUrl: string; cloud_storage_path: string }>;
}

export interface UploadServiceDependencies {
  storage: StorageClient;
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface PresignedUploadUrlData {
  uploadUrl: string;
  cloudStoragePath: string;
}

export type GenerateUploadUrlResult =
  | { success: true; data: PresignedUploadUrlData }
  | { success: false; error: string };

// ─── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_CONTENT_TYPES: ReadonlyArray<string> = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

const ALLOWED_TYPES_DESCRIPTION = "JPG, PNG, GIF, WebP, PDF";

// ─── Service Functions ───────────────────────────────────────────────────────

/** Validate file content type and generate a presigned upload URL. */
export async function generateUploadUrl(
  dependencies: UploadServiceDependencies,
  fileName: string,
  contentType: string,
  isPublic: boolean
): Promise<GenerateUploadUrlResult> {
  const isAllowedType = ALLOWED_CONTENT_TYPES.includes(contentType);

  if (!isAllowedType) {
    return {
      success: false,
      error: `File type not allowed. Supported: ${ALLOWED_TYPES_DESCRIPTION}`,
    };
  }

  const result = await dependencies.storage.generatePresignedUploadUrl(
    fileName,
    contentType,
    isPublic
  );

  return {
    success: true,
    data: {
      uploadUrl: result.uploadUrl,
      cloudStoragePath: result.cloud_storage_path,
    },
  };
}
