import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupPrismaMock,
  setupS3Mock,
  setupFetchMock,
  createUserSession,
  createJsonResponse,
  createErrorResponse,
} from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();
const mockS3 = setupS3Mock();
const mockFetch = setupFetchMock();

// Mock next-auth session
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// Mock fraud detection module
const mockCalculateImageHash = vi.fn();
const mockCheckForDuplicates = vi.fn();
const mockAnalyzeMetadata = vi.fn();
const mockDetectSuspiciousPatterns = vi.fn();
const mockCalculateFraudRiskScore = vi.fn();

vi.mock("@/lib/fraud-detection", () => ({
  calculateImageHash: (...args: unknown[]) => mockCalculateImageHash(...args),
  checkForDuplicates: (...args: unknown[]) => mockCheckForDuplicates(...args),
  analyzeMetadata: (...args: unknown[]) => mockAnalyzeMetadata(...args),
  detectSuspiciousPatterns: (...args: unknown[]) => mockDetectSuspiciousPatterns(...args),
  calculateFraudRiskScore: (...args: unknown[]) => mockCalculateFraudRiskScore(...args),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET as getFiles } from "@/app/api/drive/files/route";
import { POST as importFile } from "@/app/api/drive/import/route";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const GOOGLE_ACCOUNT = {
  id: "account-google-1",
  userId: "user-123",
  provider: "google",
  type: "oauth",
  providerAccountId: "google-id-123",
  access_token: "valid-access-token",
  refresh_token: "valid-refresh-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  token_type: "Bearer",
  scope: "openid email profile https://www.googleapis.com/auth/drive.readonly",
  id_token: null,
  session_state: null,
};

const EXPIRED_GOOGLE_ACCOUNT = {
  ...GOOGLE_ACCOUNT,
  id: "account-google-expired",
  access_token: "expired-access-token",
  expires_at: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago
};

const DRIVE_FOLDERS_RESPONSE = {
  files: [
    { id: "folder-1", name: "Receipts", mimeType: "application/vnd.google-apps.folder" },
    { id: "folder-2", name: "Invoices", mimeType: "application/vnd.google-apps.folder" },
  ],
};

const DRIVE_FILES_RESPONSE = {
  files: [
    {
      id: "file-1",
      name: "receipt-jan.jpg",
      mimeType: "image/jpeg",
      thumbnailLink: "https://drive.google.com/thumb/file-1",
      createdTime: "2024-01-15T10:00:00Z",
      size: "150000",
    },
    {
      id: "file-2",
      name: "receipt-feb.pdf",
      mimeType: "application/pdf",
      thumbnailLink: null,
      createdTime: "2024-02-10T14:30:00Z",
      size: "250000",
    },
  ],
};

const SAMPLE_RECEIPT = {
  id: "receipt-drive-001",
  userId: "user-123",
  cloudStoragePath: "uploads/1234567890-receipt-jan.jpg",
  isPublic: false,
  originalFilename: "receipt-jan.jpg",
  fileType: "image",
  fileSize: 150000,
  verificationStatus: "pending",
  imageHash: "drive-file-hash",
  isDuplicate: false,
  duplicateOfId: null,
  manipulationScore: 0,
  manipulationFlags: "[]",
  suspiciousPatterns: "[]",
  fraudRiskScore: 5,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
};

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options as Record<string, unknown>);
}

function createJsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupDefaultFraudMocks(): void {
  mockCalculateImageHash.mockReturnValue("drive-file-hash");
  mockCheckForDuplicates.mockResolvedValue({ isDuplicate: false });
  mockAnalyzeMetadata.mockReturnValue({ manipulationScore: 0, flags: [] });
  mockDetectSuspiciousPatterns.mockResolvedValue({ patterns: [], riskScore: 0 });
  mockCalculateFraudRiskScore.mockReturnValue(5);
}

/**
 * Configures the fetch mock to respond based on URL patterns.
 * Handles Google Drive API calls for folders, files, and metadata.
 */
function setupDriveApiFetchMock(options?: {
  folderResponse?: Response;
  fileResponse?: Response;
  metaResponse?: Response;
}): void {
  mockFetch.mockImplementation((url: string | URL | Request) => {
    const urlString = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const decodedUrl = decodeURIComponent(urlString);

    // Google token refresh endpoint
    if (urlString.includes("oauth2.googleapis.com/token")) {
      return Promise.resolve(
        createJsonResponse({
          access_token: "refreshed-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        })
      );
    }

    // Google Drive folder listing (contains "vnd.google-apps.folder" in query)
    if (decodedUrl.includes("googleapis.com/drive/v3/files?") && decodedUrl.includes("vnd.google-apps.folder")) {
      return Promise.resolve(options?.folderResponse ?? createJsonResponse(DRIVE_FOLDERS_RESPONSE));
    }

    // Google Drive file listing (contains "mimeType contains" in query)
    if (decodedUrl.includes("googleapis.com/drive/v3/files?") && decodedUrl.includes("mimeType contains")) {
      return Promise.resolve(options?.fileResponse ?? createJsonResponse(DRIVE_FILES_RESPONSE));
    }

    // Google Drive file metadata (for folder name — has fields=name)
    if (decodedUrl.includes("googleapis.com/drive/v3/files/") && decodedUrl.includes("fields=name")) {
      return Promise.resolve(options?.metaResponse ?? createJsonResponse({ name: "Test Folder" }));
    }

    // Google Drive file download (alt=media)
    if (decodedUrl.includes("googleapis.com/drive/v3/files/") && decodedUrl.includes("alt=media")) {
      return Promise.resolve(createJsonResponse("fake-file-binary-content"));
    }

    // S3 upload (PUT to presigned URL)
    if (urlString.includes("fake-s3.example.com/upload")) {
      return Promise.resolve(createJsonResponse({ success: true }));
    }

    // Default: return 404
    return Promise.resolve(createErrorResponse(404));
  });
}

// ─── Tests: GET /api/drive/files ───────────────────────────────────────────────

describe("GET /api/drive/files", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockFetch.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/drive/files");
    const response = await getFiles(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when no Google account is linked", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(null);

    const request = createRequest("/api/drive/files");
    const response = await getFiles(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("Google account not connected");
  });

  it("returns folders and files from Google Drive with valid token", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    setupDriveApiFetchMock();

    const request = createRequest("/api/drive/files");
    const response = await getFiles(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.folders).toHaveLength(2);
    expect(body.files).toHaveLength(2);
    expect(body.currentFolder.id).toBe("root");
    expect(body.currentFolder.name).toBe("Mijn Drive");
  });

  it("refreshes expired token before making Drive API calls", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(EXPIRED_GOOGLE_ACCOUNT as any);
    mockPrisma.account.update.mockResolvedValue({
      ...EXPIRED_GOOGLE_ACCOUNT,
      access_token: "refreshed-access-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    } as any);

    setupDriveApiFetchMock();

    const request = createRequest("/api/drive/files");
    const response = await getFiles(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.folders).toBeDefined();
    expect(body.files).toBeDefined();

    // Verify token refresh was called
    expect(mockFetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
      })
    );

    // Verify account was updated with new token
    expect(mockPrisma.account.update).toHaveBeenCalledWith({
      where: { id: "account-google-expired" },
      data: expect.objectContaining({
        access_token: "refreshed-access-token",
      }),
    });
  });

  it("fetches files from a specific folder when folderId is provided", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    setupDriveApiFetchMock();

    const request = createRequest("/api/drive/files?folderId=folder-1");
    const response = await getFiles(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.currentFolder.id).toBe("folder-1");
    expect(body.currentFolder.name).toBe("Test Folder");
  });

  it("returns 401 when Google Drive API returns 401 (token fully expired)", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);

    mockFetch.mockImplementation((url: string | URL | Request) => {
      const urlString = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

      if (urlString.includes("googleapis.com/drive/v3/files")) {
        return Promise.resolve(createErrorResponse(401, "Token expired"));
      }

      return Promise.resolve(createErrorResponse(404));
    });

    const request = createRequest("/api/drive/files");
    const response = await getFiles(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain("Google token expired");
  });

  it("handles sharedWithMe parameter for shared files", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    setupDriveApiFetchMock();

    const request = createRequest("/api/drive/files?sharedWithMe=true");
    const response = await getFiles(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.folders).toBeDefined();
    expect(body.files).toBeDefined();
  });
});

// ─── Tests: POST /api/drive/import ─────────────────────────────────────────────

describe("POST /api/drive/import", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockFetch.mockReset();
    mockCalculateImageHash.mockReset();
    mockCheckForDuplicates.mockReset();
    mockAnalyzeMetadata.mockReset();
    mockDetectSuspiciousPatterns.mockReset();
    mockCalculateFraudRiskScore.mockReset();
    setupDefaultFraudMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    const response = await importFile(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when no Google account is linked", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(null);

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    const response = await importFile(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("Google account not connected");
  });

  it("returns 400 when fileId is missing", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    const response = await importFile(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("File ID and name are required");
  });

  it("returns 400 when fileName is missing", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      mimeType: "image/jpeg",
    });
    const response = await importFile(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("File ID and name are required");
  });

  it("imports a file successfully through the full pipeline", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);
    // Mock for triggerOCR background call
    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt-jan.jpg",
      mimeType: "image/jpeg",
    });
    const response = await importFile(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.receiptId).toBe("receipt-drive-001");
    expect(body.message).toBe("File imported successfully");
  });

  it("downloads file from Google Drive using the correct URL", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);
    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileId: "drive-file-abc",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    await importFile(request);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/drive-file-abc?alt=media",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer valid-access-token",
        }),
      })
    );
  });

  it("uploads downloaded file to S3 via presigned URL", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);
    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    await importFile(request);

    // Verify S3 presigned URL was generated
    expect(mockS3.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "receipt.jpg",
      "image/jpeg",
      false
    );

    // Verify upload to S3 was attempted
    expect(mockFetch).toHaveBeenCalledWith(
      "https://fake-s3.example.com/upload?signed=true",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Type": "image/jpeg",
        }),
      })
    );
  });

  it("creates a receipt record with fraud detection results", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);
    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    mockCalculateImageHash.mockReturnValue("imported-file-hash");
    mockCheckForDuplicates.mockResolvedValue({ isDuplicate: false });
    mockAnalyzeMetadata.mockReturnValue({ manipulationScore: 10, flags: ["NO_EXIF_DATA"] });
    mockDetectSuspiciousPatterns.mockResolvedValue({ patterns: [], riskScore: 0 });
    mockCalculateFraudRiskScore.mockReturnValue(8);

    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    await importFile(request);

    expect(mockPrisma.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-123",
        cloudStoragePath: "uploads/1234567890-test-file.jpg",
        isPublic: false,
        originalFilename: "receipt.jpg",
        fileType: "image",
        imageHash: "imported-file-hash",
        isDuplicate: false,
        manipulationScore: 10,
        manipulationFlags: JSON.stringify(["NO_EXIF_DATA"]),
        suspiciousPatterns: JSON.stringify([]),
        fraudRiskScore: 8,
        verificationStatus: "pending",
      }),
    });
  });

  it("returns 500 when file download from Drive fails", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);

    mockFetch.mockImplementation((url: string | URL | Request) => {
      const urlString = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

      if (urlString.includes("alt=media")) {
        return Promise.resolve(createErrorResponse(403, "Access denied"));
      }

      return Promise.resolve(createJsonResponse({ success: true }));
    });

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    const response = await importFile(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("Failed to download file from Google Drive");
  });

  it("returns 500 when S3 upload fails", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);

    mockFetch.mockImplementation((url: string | URL | Request) => {
      const urlString = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

      // Drive download succeeds
      if (urlString.includes("alt=media")) {
        return Promise.resolve(createJsonResponse("fake-file-content"));
      }

      // S3 upload fails
      if (urlString.includes("fake-s3.example.com/upload")) {
        return Promise.resolve(createErrorResponse(500, "Storage error"));
      }

      return Promise.resolve(createJsonResponse({ success: true }));
    });

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
    });
    const response = await importFile(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("Failed to upload file to storage");
  });

  it("determines correct content type from mimeType parameter", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    mockPrisma.receipt.create.mockResolvedValue({
      ...SAMPLE_RECEIPT,
      fileType: "pdf",
      originalFilename: "invoice.pdf",
    } as any);
    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-2",
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
    });
    await importFile(request);

    expect(mockS3.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "invoice.pdf",
      "application/pdf",
      false
    );

    expect(mockPrisma.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fileType: "pdf",
        originalFilename: "invoice.pdf",
      }),
    });
  });

  it("detects content type from filename extension when mimeType is generic", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.account.findFirst.mockResolvedValue(GOOGLE_ACCOUNT as any);
    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);
    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    setupDriveApiFetchMock();

    const request = createJsonRequest("/api/drive/import", {
      fileId: "file-1",
      fileName: "receipt.png",
      mimeType: "application/octet-stream",
    });
    await importFile(request);

    expect(mockS3.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "receipt.png",
      "image/png",
      false
    );
  });
});
