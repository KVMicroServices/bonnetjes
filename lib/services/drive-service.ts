import { PrismaClient } from "@prisma/client";
import { refreshGoogleToken } from "./auth-service";
import { createReceipt, FraudDetectionModule } from "./receipt-service";
import { processReceiptOcr } from "./ocr-service";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOKEN_EXPIRY_BUFFER_MILLISECONDS = 5 * 60 * 1000;
const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files";
const SHARED_DRIVE_PARAMS = "&supportsAllDrives=true&includeItemsFromAllDrives=true";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const FOLDER_PAGE_SIZE = 100;
const FILE_PAGE_SIZE = 50;
const DEFAULT_FOLDER_NAME = "Mijn Drive";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface StorageUploadClient {
  generatePresignedUploadUrl(
    fileName: string,
    contentType: string,
    isPublic: boolean
  ): Promise<{ uploadUrl: string; cloud_storage_path: string }>;
  getFileAsBuffer(cloudStoragePath: string): Promise<Buffer>;
  getFileUrl(cloudStoragePath: string, isPublic: boolean): Promise<string>;
}

export interface OcrServiceClient {
  processReceiptOcr(receiptId: string): Promise<{ success: boolean; error?: string }>;
}

export interface DriveServiceDependencies {
  database: PrismaClient;
  storage: StorageUploadClient;
  fraudDetection: FraudDetectionModule;
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  createdTime?: string;
  size?: string;
}

export interface CurrentFolder {
  id: string;
  name: string;
}

export type GetAccessTokenResult =
  | { success: true; accessToken: string }
  | { success: false; error: string };

export type ListDriveFilesResult =
  | { success: true; folders: ReadonlyArray<DriveFolder>; files: ReadonlyArray<DriveFile>; currentFolder: CurrentFolder }
  | { success: false; error: string; statusCode: number };

export type ImportDriveFileResult =
  | { success: true; receiptId: string; message: string }
  | { success: false; error: string; statusCode: number };

// ─── Service Functions ───────────────────────────────────────────────────────

/** Retrieve a valid Google access token for the user, refreshing if expired. */
export async function getAccessToken(
  dependencies: Pick<DriveServiceDependencies, "database">,
  userId: string
): Promise<GetAccessTokenResult> {
  const account = await dependencies.database.account.findFirst({
    where: {
      userId,
      provider: "google",
    },
  });

  if (!account) {
    return { success: false, error: "Google account not connected" };
  }

  const isExpired =
    account.expires_at &&
    account.expires_at * 1000 < Date.now() + TOKEN_EXPIRY_BUFFER_MILLISECONDS;

  if (isExpired && account.refresh_token) {
    const refreshResult = await refreshGoogleToken(
      { database: dependencies.database },
      account.id
    );

    if (!refreshResult.success) {
      return { success: false, error: refreshResult.error };
    }

    return { success: true, accessToken: refreshResult.accessToken };
  }

  if (!account.access_token) {
    return { success: false, error: "No access token available" };
  }

  return { success: true, accessToken: account.access_token };
}

/** List folders and files from Google Drive for a given folder. */
export async function listDriveFiles(
  accessToken: string,
  folderId: string,
  sharedWithMe: boolean
): Promise<ListDriveFilesResult> {
  let folderQuery: string;
  let fileQuery: string;

  if (sharedWithMe && folderId === "root") {
    folderQuery = `sharedWithMe = true and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`;
    fileQuery = `sharedWithMe = true and (mimeType contains 'image/' or mimeType = 'application/pdf') and trashed = false`;
  } else {
    folderQuery = `'${folderId}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`;
    fileQuery = `'${folderId}' in parents and (mimeType contains 'image/' or mimeType = 'application/pdf') and trashed = false`;
  }

  const folderUrl = `${GOOGLE_DRIVE_API_BASE}?q=${encodeURIComponent(folderQuery)}&fields=files(id,name,mimeType)&orderBy=name&pageSize=${FOLDER_PAGE_SIZE}${SHARED_DRIVE_PARAMS}`;
  const fileUrl = `${GOOGLE_DRIVE_API_BASE}?q=${encodeURIComponent(fileQuery)}&fields=files(id,name,mimeType,thumbnailLink,createdTime,size)&orderBy=createdTime desc&pageSize=${FILE_PAGE_SIZE}${SHARED_DRIVE_PARAMS}`;

  const folderResponse = await fetch(folderUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const fileResponse = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!folderResponse.ok || !fileResponse.ok) {
    const failedResponse = !folderResponse.ok ? folderResponse : fileResponse;
    const statusCode = failedResponse.status;

    if (statusCode === 401) {
      return {
        success: false,
        error: "Google token expired. Please sign out and sign in again with Google.",
        statusCode: 401,
      };
    }

    return {
      success: false,
      error: "Failed to fetch files from Google Drive",
      statusCode,
    };
  }

  const folderData = await folderResponse.json();
  const fileData = await fileResponse.json();

  let currentFolderName = DEFAULT_FOLDER_NAME;
  if (folderId !== "root") {
    const metaUrl = `${GOOGLE_DRIVE_API_BASE}/${folderId}?fields=name`;
    const metaResponse = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (metaResponse.ok) {
      const metaData = await metaResponse.json();
      currentFolderName = metaData.name;
    }
  }

  const folders: DriveFolder[] = folderData.files || [];
  const files: DriveFile[] = fileData.files || [];

  return {
    success: true,
    folders,
    files,
    currentFolder: {
      id: folderId,
      name: currentFolderName,
    },
  };
}

/** Download a file from Google Drive, upload to S3, create a receipt, and trigger OCR. */
export async function importDriveFile(
  dependencies: DriveServiceDependencies,
  userId: string,
  fileId: string,
  fileName: string,
  mimeType: string | undefined
): Promise<ImportDriveFileResult> {
  if (!fileId || !fileName) {
    return {
      success: false,
      error: "File ID and name are required",
      statusCode: 400,
    };
  }

  const tokenResult = await getAccessToken(dependencies, userId);

  if (!tokenResult.success) {
    return { success: false, error: tokenResult.error, statusCode: 403 };
  }

  const accessToken = tokenResult.accessToken;

  // Download file from Google Drive
  const downloadUrl = `${GOOGLE_DRIVE_API_BASE}/${fileId}?alt=media`;
  const fileResponse = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!fileResponse.ok) {
    return {
      success: false,
      error: "Failed to download file from Google Drive",
      statusCode: 500,
    };
  }

  const fileArrayBuffer = await fileResponse.arrayBuffer();
  const fileBuffer = Buffer.from(fileArrayBuffer);
  const fileSize = fileBuffer.length;

  // Determine content type
  const contentType = resolveContentType(mimeType, fileName);
  const fileType = resolveFileType(contentType);

  // Upload to S3
  const presignedResult = await dependencies.storage.generatePresignedUploadUrl(
    fileName,
    contentType,
    false
  );

  const uploadResponse = await fetch(presignedResult.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: fileBuffer,
  });

  if (!uploadResponse.ok) {
    return {
      success: false,
      error: "Failed to upload file to storage",
      statusCode: 500,
    };
  }

  // Create receipt via receipt-service
  const receiptResult = await createReceipt(
    { database: dependencies.database, storage: dependencies.storage },
    userId,
    {
      cloudStoragePath: presignedResult.cloud_storage_path,
      isPublic: false,
      originalFilename: fileName,
      fileType,
      fileSize,
    },
    dependencies.fraudDetection
  );

  if (!receiptResult.success) {
    return {
      success: false,
      error: receiptResult.error,
      statusCode: receiptResult.statusCode,
    };
  }

  const receiptId = receiptResult.receipt.id;

  // Trigger OCR in the background (non-blocking)
  const ocrDependencies = {
    database: dependencies.database,
    storage: dependencies.storage,
    fraudDetection: {
      detectSuspiciousPatterns: dependencies.fraudDetection.detectSuspiciousPatterns,
      calculateFraudRiskScore: dependencies.fraudDetection.calculateFraudRiskScore,
    },
  };

  processReceiptOcr(ocrDependencies, receiptId).catch(() => {
    // OCR failure is non-fatal for the import operation
  });

  return {
    success: true,
    receiptId,
    message: "File imported successfully",
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function resolveContentType(
  mimeType: string | undefined,
  fileName: string
): string {
  if (mimeType && mimeType.startsWith("image/")) {
    return mimeType;
  }

  if (mimeType === "application/pdf") {
    return mimeType;
  }

  // Detect from filename extension
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension === "pdf") {
    return "application/pdf";
  }

  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }

  if (extension === "png") {
    return "image/png";
  }

  if (mimeType) {
    return mimeType;
  }

  return DEFAULT_CONTENT_TYPE;
}

function resolveFileType(contentType: string): string {
  if (contentType.startsWith("image/")) {
    return "image";
  }

  return "pdf";
}
