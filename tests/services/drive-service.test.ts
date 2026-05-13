import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockDeep, DeepMockProxy } from "vitest-mock-extended";
import { PrismaClient } from "@prisma/client";

// ─── Module Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/services/auth-service", () => ({
  refreshGoogleToken: vi.fn(),
}));

vi.mock("@/lib/services/receipt-service", () => ({
  createReceipt: vi.fn(),
}));

vi.mock("@/lib/services/ocr-service", () => ({
  processReceiptOcr: vi.fn(),
}));

import {
  getAccessToken,
  listDriveFiles,
  importDriveFile,
} from "@/lib/services/drive-service";
import type {
  StorageUploadClient,
  DriveServiceDependencies,
} from "@/lib/services/drive-service";
import type { FraudDetectionModule } from "@/lib/services/receipt-service";
import { refreshGoogleToken } from "@/lib/services/auth-service";
import { createReceipt } from "@/lib/services/receipt-service";
import { processReceiptOcr } from "@/lib/services/ocr-service";

// ─── Mock Factories ────────────────────────────────────────────────────────────

function createMockDatabase(): DeepMockProxy<PrismaClient> {
  return mockDeep<PrismaClient>();
}

function createMockStorage(): StorageUploadClient {
  return {
    generatePresignedUploadUrl: vi.fn().mockResolvedValue({
      uploadUrl: "https://storage.example.com/presigned-upload",
      cloud_storage_path: "uploads/imported-file.jpg",
    }),
    getFileAsBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-content")),
  };
}

function createMockFraudDetection(): FraudDetectionModule {
  return {
    calculateImageHash: vi.fn().mockReturnValue("hash-abc"),
    checkForDuplicates: vi.fn().mockResolvedValue({ isDuplicate: false }),
    analyzeMetadata: vi.fn().mockReturnValue({ manipulationScore: 0, flags: [] }),
    detectSuspiciousPatterns: vi.fn().mockResolvedValue({ patterns: [], riskScore: 0 }),
    calculateFraudRiskScore: vi.fn().mockReturnValue(5),
  };
}

function createFullDependencies(): {
  database: DeepMockProxy<PrismaClient>;
  storage: StorageUploadClient;
  fraudDetection: FraudDetectionModule;
} {
  return {
    database: createMockDatabase(),
    storage: createMockStorage(),
    fraudDetection: createMockFraudDetection(),
  };
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const USER_ID = "user-123";
const ACCOUNT_ID = "account-456";
const VALID_ACCESS_TOKEN = "ya29.valid-token";
const REFRESHED_ACCESS_TOKEN = "ya29.refreshed-token";

const GOOGLE_ACCOUNT = {
  id: ACCOUNT_ID,
  userId: USER_ID,
  provider: "google",
  type: "oauth",
  providerAccountId: "google-123",
  access_token: VALID_ACCESS_TOKEN,
  refresh_token: "refresh-token-abc",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "Bearer",
  scope: "openid email",
  id_token: null,
  session_state: null,
};

const EXPIRED_GOOGLE_ACCOUNT = {
  ...GOOGLE_ACCOUNT,
  expires_at: Math.floor(Date.now() / 1000) - 600,
};

// ─── Global Fetch Mock ─────────────────────────────────────────────────────────

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Tests: getAccessToken ─────────────────────────────────────────────────────

describe("getAccessToken", () => {
  let database: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    database = createMockDatabase();
  });

  it("returns existing token when not expired", async () => {
    database.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);

    const result = await getAccessToken({ database }, USER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.accessToken).toBe(VALID_ACCESS_TOKEN);
    }
  });

  it("refreshes token when expired and returns new token", async () => {
    database.account.findFirst.mockResolvedValue(EXPIRED_GOOGLE_ACCOUNT as any);
    (refreshGoogleToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      accessToken: REFRESHED_ACCESS_TOKEN,
    });

    const result = await getAccessToken({ database }, USER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.accessToken).toBe(REFRESHED_ACCESS_TOKEN);
    }
    expect(refreshGoogleToken).toHaveBeenCalledWith(
      { database },
      ACCOUNT_ID
    );
  });

  it("returns error when account not found", async () => {
    database.account.findFirst.mockResolvedValue(null);

    const result = await getAccessToken({ database }, USER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Google account not connected");
    }
  });

  it("returns error when token refresh fails", async () => {
    database.account.findFirst.mockResolvedValue(EXPIRED_GOOGLE_ACCOUNT as any);
    (refreshGoogleToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Token refresh request failed",
    });

    const result = await getAccessToken({ database }, USER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Token refresh request failed");
    }
  });
});

// ─── Tests: listDriveFiles ─────────────────────────────────────────────────────

describe("listDriveFiles", () => {
  it("returns folders and files on success", async () => {
    const mockFolderResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        files: [{ id: "folder-1", name: "Receipts", mimeType: "application/vnd.google-apps.folder" }],
      }),
    };
    const mockFileResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        files: [{ id: "file-1", name: "receipt.jpg", mimeType: "image/jpeg", size: "50000" }],
      }),
    };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockFolderResponse)
      .mockResolvedValueOnce(mockFileResponse);

    const result = await listDriveFiles(VALID_ACCESS_TOKEN, "root", false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].name).toBe("Receipts");
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe("receipt.jpg");
      expect(result.currentFolder.id).toBe("root");
      expect(result.currentFolder.name).toBe("Mijn Drive");
    }
  });

  it("handles shared drive queries when sharedWithMe is true", async () => {
    const mockFolderResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ files: [] }),
    };
    const mockFileResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ files: [] }),
    };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockFolderResponse)
      .mockResolvedValueOnce(mockFileResponse);

    const result = await listDriveFiles(VALID_ACCESS_TOKEN, "root", true);

    expect(result.success).toBe(true);
    const folderCallUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(folderCallUrl).toContain("sharedWithMe");
  });

  it("returns 401 error with specific message when token expired", async () => {
    const mockUnauthorizedResponse = {
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: { message: "Invalid Credentials" } }),
    };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockUnauthorizedResponse)
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ files: [] }) });

    const result = await listDriveFiles(VALID_ACCESS_TOKEN, "root", false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(401);
      expect(result.error).toContain("Google token expired");
    }
  });

  it("fetches folder metadata for non-root folder", async () => {
    const folderId = "folder-abc";
    const mockFolderResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ files: [] }),
    };
    const mockFileResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ files: [] }),
    };
    const mockMetaResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ name: "My Folder" }),
    };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockFolderResponse)
      .mockResolvedValueOnce(mockFileResponse)
      .mockResolvedValueOnce(mockMetaResponse);

    const result = await listDriveFiles(VALID_ACCESS_TOKEN, folderId, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.currentFolder.name).toBe("My Folder");
      expect(result.currentFolder.id).toBe(folderId);
    }
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

// ─── Tests: importDriveFile ────────────────────────────────────────────────────

describe("importDriveFile", () => {
  let dependencies: ReturnType<typeof createFullDependencies>;

  beforeEach(() => {
    dependencies = createFullDependencies();
  });

  it("completes full import pipeline: download, upload, create receipt, trigger OCR", async () => {
    // Setup: account lookup for getAccessToken
    dependencies.database.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);

    // Setup: Google Drive download
    const fileBuffer = Buffer.from("fake-image-data");
    const mockDownloadResponse = {
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(fileBuffer.buffer),
    };

    // Setup: S3 upload
    const mockUploadResponse = { ok: true, status: 200 };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockDownloadResponse)
      .mockResolvedValueOnce(mockUploadResponse);

    // Setup: createReceipt
    (createReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      receipt: { id: "receipt-new-123" },
    });

    // Setup: processReceiptOcr
    (processReceiptOcr as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      verificationStatus: "verified",
    });

    const result = await importDriveFile(
      dependencies as unknown as DriveServiceDependencies,
      USER_ID,
      "drive-file-id",
      "receipt.jpg",
      "image/jpeg"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receiptId).toBe("receipt-new-123");
      expect(result.message).toBe("File imported successfully");
    }

    // Verify download was called
    const downloadCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(downloadCall[0]).toContain("drive-file-id");
    expect(downloadCall[0]).toContain("alt=media");

    // Verify upload was called
    expect(dependencies.storage.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "receipt.jpg",
      "image/jpeg",
      false
    );

    // Verify receipt creation
    expect(createReceipt).toHaveBeenCalled();

    // Verify OCR was triggered
    expect(processReceiptOcr).toHaveBeenCalled();
  });

  it("returns 400 when fileId is missing", async () => {
    const result = await importDriveFile(
      dependencies as unknown as DriveServiceDependencies,
      USER_ID,
      "",
      "receipt.jpg",
      "image/jpeg"
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe("File ID and name are required");
    }
  });

  it("returns 400 when fileName is missing", async () => {
    const result = await importDriveFile(
      dependencies as unknown as DriveServiceDependencies,
      USER_ID,
      "drive-file-id",
      "",
      "image/jpeg"
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe("File ID and name are required");
    }
  });

  it("returns 500 when Google Drive download fails", async () => {
    dependencies.database.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);

    const mockFailedDownload = {
      ok: false,
      status: 404,
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFailedDownload);

    const result = await importDriveFile(
      dependencies as unknown as DriveServiceDependencies,
      USER_ID,
      "drive-file-id",
      "receipt.jpg",
      "image/jpeg"
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(500);
      expect(result.error).toBe("Failed to download file from Google Drive");
    }
  });
});
