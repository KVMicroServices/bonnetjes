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
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const ALLOWED_EXTENSIONS: ReadonlyArray<string> = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".heic", ".heif",
  ".pdf",
  ".doc", ".docx",
];

const ALLOWED_TYPES_DESCRIPTION = "JPG, PNG, GIF, WebP, HEIC, PDF, DOC, DOCX";

// ─── Service Functions ───────────────────────────────────────────────────────

/** Validate file content type and generate a presigned upload URL. */
export async function generateUploadUrl(
  dependencies: UploadServiceDependencies,
  fileName: string,
  contentType: string,
  isPublic: boolean
): Promise<GenerateUploadUrlResult> {
  const isAllowedType = ALLOWED_CONTENT_TYPES.includes(contentType);
  const extension = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  const isAllowedExtension = ALLOWED_EXTENSIONS.includes(extension);

  // Allow octet-stream if the file extension is recognized (browsers often misreport HEIC)
  const isOctetStreamWithValidExtension = contentType === "application/octet-stream" && isAllowedExtension;

  if (!isAllowedType && !isOctetStreamWithValidExtension) {
    return {
      success: false,
      error: `File type not allowed. Supported: ${ALLOWED_TYPES_DESCRIPTION}`,
    };
  }

  // Use the correct content type based on extension when browser sends octet-stream
  let effectiveContentType = contentType;
  if (isOctetStreamWithValidExtension) {
    effectiveContentType = resolveContentTypeFromExtension(extension);
  }

  const result = await dependencies.storage.generatePresignedUploadUrl(
    fileName,
    effectiveContentType,
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

function resolveContentTypeFromExtension(extension: string): string {
  const extensionToMime: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };

  const mappedType = extensionToMime[extension];
  if (mappedType) {
    return mappedType;
  }
  return "application/octet-stream";
}
