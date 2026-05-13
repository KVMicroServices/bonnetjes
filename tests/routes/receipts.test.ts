import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupPrismaMock,
  setupS3Mock,
  createUserSession,
  createAdminSession,
} from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();
const mockS3 = setupS3Mock();

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

import { GET as getReceipts, POST as createReceipt } from "@/app/api/receipts/route";
import { GET as getReceiptById, PATCH as patchReceipt } from "@/app/api/receipts/[id]/route";
import { GET as getDownload } from "@/app/api/receipts/[id]/download/route";
import { POST as archiveReceipts, GET as getArchivedReceipts } from "@/app/api/receipts/archive/route";
import { POST as getPresignedUploadUrl } from "@/app/api/upload/presigned/route";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_RECEIPT = {
  id: "receipt-001",
  userId: "user-123",
  cloudStoragePath: "uploads/1234567890-receipt.jpg",
  isPublic: false,
  originalFilename: "receipt.jpg",
  fileType: "image",
  fileSize: 150000,
  verificationStatus: "pending",
  imageHash: "abc123hash",
  isDuplicate: false,
  duplicateOfId: null,
  manipulationScore: 0,
  manipulationFlags: "[]",
  suspiciousPatterns: "[]",
  fraudRiskScore: 5,
  extractedShopName: null,
  extractedDate: null,
  extractedAmount: null,
  isArchived: false,
  archivedAt: null,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  processedAt: null,
  user: { id: "user-123", name: "Test User", email: "user@example.com" },
};

const SAMPLE_ADMIN_RECEIPT = {
  ...SAMPLE_RECEIPT,
  id: "receipt-002",
  userId: "other-user-789",
  user: { id: "other-user-789", name: "Other User", email: "other@example.com" },
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

function createPatchRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Default Fraud Detection Mock Values ───────────────────────────────────────

function setupDefaultFraudMocks(): void {
  mockCalculateImageHash.mockReturnValue("fake-image-hash-abc123");
  mockCheckForDuplicates.mockResolvedValue({ isDuplicate: false });
  mockAnalyzeMetadata.mockReturnValue({ manipulationScore: 0, flags: [] });
  mockDetectSuspiciousPatterns.mockResolvedValue({ patterns: [], riskScore: 0 });
  mockCalculateFraudRiskScore.mockReturnValue(5);
}


// ─── Tests: GET /api/receipts ──────────────────────────────────────────────────

describe("GET /api/receipts", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockCalculateImageHash.mockReset();
    mockCheckForDuplicates.mockReset();
    mockAnalyzeMetadata.mockReset();
    mockDetectSuspiciousPatterns.mockReset();
    mockCalculateFraudRiskScore.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/receipts");
    const response = await getReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns only user receipts for non-admin users", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findMany.mockResolvedValue([SAMPLE_RECEIPT] as any);

    const request = createRequest("/api/receipts");
    const response = await getReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("receipt-001");

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-123" },
      })
    );
  });

  it("returns all receipts for admin users", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findMany.mockResolvedValue([SAMPLE_RECEIPT, SAMPLE_ADMIN_RECEIPT] as any);

    const request = createRequest("/api/receipts");
    const response = await getReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      })
    );
  });

  it("returns receipts ordered by createdAt descending", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findMany.mockResolvedValue([]);

    const request = createRequest("/api/receipts");
    await getReceipts(request);

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      })
    );
  });
});

// ─── Tests: POST /api/receipts ─────────────────────────────────────────────────

describe("POST /api/receipts", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockCalculateImageHash.mockReset();
    mockCheckForDuplicates.mockReset();
    mockAnalyzeMetadata.mockReset();
    mockDetectSuspiciousPatterns.mockReset();
    mockCalculateFraudRiskScore.mockReset();
    setupDefaultFraudMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createJsonRequest("/api/receipts", {
      cloudStoragePath: "uploads/test.jpg",
    });
    const response = await createReceipt(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when cloudStoragePath is missing", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/receipts", {});
    const response = await createReceipt(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing cloudStoragePath");
  });

  it("creates a receipt with fraud detection and returns 201", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const createdReceipt = {
      ...SAMPLE_RECEIPT,
      id: "new-receipt-id",
    };
    mockPrisma.receipt.create.mockResolvedValue(createdReceipt as any);

    const request = createJsonRequest("/api/receipts", {
      cloudStoragePath: "uploads/1234567890-receipt.jpg",
      isPublic: false,
      originalFilename: "receipt.jpg",
      fileType: "image",
      fileSize: 150000,
    });
    const response = await createReceipt(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe("new-receipt-id");
  });

  it("calls fraud detection functions during receipt creation", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);

    const request = createJsonRequest("/api/receipts", {
      cloudStoragePath: "uploads/test-receipt.jpg",
      originalFilename: "test-receipt.jpg",
      fileType: "image",
      fileSize: 100000,
    });
    await createReceipt(request);

    expect(mockS3.getFileAsBuffer).toHaveBeenCalledWith("uploads/test-receipt.jpg");
    expect(mockCalculateImageHash).toHaveBeenCalled();
    expect(mockCheckForDuplicates).toHaveBeenCalledWith("fake-image-hash-abc123", "user-123");
    expect(mockAnalyzeMetadata).toHaveBeenCalled();
    expect(mockDetectSuspiciousPatterns).toHaveBeenCalledWith("user-123", null, null);
    expect(mockCalculateFraudRiskScore).toHaveBeenCalled();
  });

  it("persists fraud detection results in the created receipt", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockCalculateImageHash.mockReturnValue("detected-hash-xyz");
    mockCheckForDuplicates.mockResolvedValue({ isDuplicate: true, duplicateOfId: "existing-receipt-99" });
    mockAnalyzeMetadata.mockReturnValue({ manipulationScore: 30, flags: ["ADOBE_SOFTWARE_DETECTED"] });
    mockDetectSuspiciousPatterns.mockResolvedValue({ patterns: ["HIGH_SUBMISSION_FREQUENCY"], riskScore: 25 });
    mockCalculateFraudRiskScore.mockReturnValue(72);

    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);

    const request = createJsonRequest("/api/receipts", {
      cloudStoragePath: "uploads/suspicious.jpg",
    });
    await createReceipt(request);

    expect(mockPrisma.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        imageHash: "detected-hash-xyz",
        isDuplicate: true,
        duplicateOfId: "existing-receipt-99",
        manipulationScore: 30,
        manipulationFlags: JSON.stringify(["ADOBE_SOFTWARE_DETECTED"]),
        suspiciousPatterns: JSON.stringify(["HIGH_SUBMISSION_FREQUENCY"]),
        fraudRiskScore: 72,
      }),
    });
  });

  it("still creates receipt when fraud detection throws an error", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockS3.getFileAsBuffer.mockRejectedValue(new Error("S3 connection failed"));
    mockCalculateFraudRiskScore.mockReturnValue(0);
    mockPrisma.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);

    const request = createJsonRequest("/api/receipts", {
      cloudStoragePath: "uploads/test.jpg",
    });
    const response = await createReceipt(request);

    expect(response.status).toBe(201);
    expect(mockPrisma.receipt.create).toHaveBeenCalled();
  });
});


// ─── Tests: GET /api/receipts/[id] ─────────────────────────────────────────────

describe("GET /api/receipts/[id]", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/receipts/receipt-001");
    const response = await getReceiptById(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when receipt does not exist", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    const request = createRequest("/api/receipts/nonexistent");
    const response = await getReceiptById(request, { params: Promise.resolve({ id: "nonexistent" }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Receipt not found");
  });

  it("returns 403 when non-admin user tries to access another user receipt", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const otherUserReceipt = {
      ...SAMPLE_RECEIPT,
      id: "receipt-other",
      userId: "other-user-789",
      adminActions: [],
    };
    mockPrisma.receipt.findUnique.mockResolvedValue(otherUserReceipt as any);

    const request = createRequest("/api/receipts/receipt-other");
    const response = await getReceiptById(request, { params: Promise.resolve({ id: "receipt-other" }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Access denied");
  });

  it("returns receipt for the owning user", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const receiptWithActions = {
      ...SAMPLE_RECEIPT,
      adminActions: [],
    };
    mockPrisma.receipt.findUnique.mockResolvedValue(receiptWithActions as any);

    const request = createRequest("/api/receipts/receipt-001");
    const response = await getReceiptById(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("receipt-001");
  });

  it("returns any receipt for admin users", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const otherUserReceipt = {
      ...SAMPLE_RECEIPT,
      id: "receipt-other",
      userId: "other-user-789",
      adminActions: [],
    };
    mockPrisma.receipt.findUnique.mockResolvedValue(otherUserReceipt as any);

    const request = createRequest("/api/receipts/receipt-other");
    const response = await getReceiptById(request, { params: Promise.resolve({ id: "receipt-other" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("receipt-other");
  });
});

// ─── Tests: PATCH /api/receipts/[id] ───────────────────────────────────────────

describe("PATCH /api/receipts/[id]", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest("/api/receipts/receipt-001", {
      verificationStatus: "approved",
    });
    const response = await patchReceipt(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when non-admin user tries to update status", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest("/api/receipts/receipt-001", {
      verificationStatus: "approved",
    });
    const response = await patchReceipt(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("updates receipt status and logs admin action for admin users", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const updatedReceipt = {
      ...SAMPLE_RECEIPT,
      verificationStatus: "approved",
      processedAt: new Date(),
    };
    mockPrisma.receipt.update.mockResolvedValue(updatedReceipt as any);
    mockPrisma.adminAction.create.mockResolvedValue({} as any);

    const request = createPatchRequest("/api/receipts/receipt-001", {
      verificationStatus: "approved",
      notes: "Looks legitimate",
    });
    const response = await patchReceipt(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verificationStatus).toBe("approved");

    expect(mockPrisma.receipt.update).toHaveBeenCalledWith({
      where: { id: "receipt-001" },
      data: expect.objectContaining({
        verificationStatus: "approved",
      }),
    });

    expect(mockPrisma.adminAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-456",
        receiptId: "receipt-001",
        action: "approved",
        notes: "Looks legitimate",
      }),
    });
  });
});


// ─── Tests: POST /api/receipts/archive ─────────────────────────────────────────

describe("POST /api/receipts/archive", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createJsonRequest("/api/receipts/archive", {
      receiptIds: ["receipt-001"],
    });
    const response = await archiveReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when receiptIds is missing or not an array", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/receipts/archive", {});
    const response = await archiveReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Receipt IDs required");
  });

  it("archives receipts for regular user (only their own)", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.updateMany.mockResolvedValue({ count: 2 } as any);

    const request = createJsonRequest("/api/receipts/archive", {
      receiptIds: ["receipt-001", "receipt-003"],
    });
    const response = await archiveReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.archivedCount).toBe(2);

    expect(mockPrisma.receipt.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: ["receipt-001", "receipt-003"] },
        isArchived: false,
        userId: "user-123",
      }),
      data: expect.objectContaining({
        isArchived: true,
      }),
    });
  });

  it("archives any receipts for admin users (no userId filter)", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.updateMany.mockResolvedValue({ count: 3 } as any);

    const request = createJsonRequest("/api/receipts/archive", {
      receiptIds: ["receipt-001", "receipt-002", "receipt-003"],
    });
    const response = await archiveReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.archivedCount).toBe(3);

    const updateManyCall = mockPrisma.receipt.updateMany.mock.calls[0][0];
    expect(updateManyCall.where).not.toHaveProperty("userId");
  });
});

// ─── Tests: GET /api/receipts/archive ──────────────────────────────────────────

describe("GET /api/receipts/archive", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/receipts/archive");
    const response = await getArchivedReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns archived receipts grouped by date for regular user", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const archivedReceipts = [
      {
        ...SAMPLE_RECEIPT,
        id: "archived-1",
        isArchived: true,
        archivedAt: new Date("2024-01-15T10:00:00Z"),
      },
      {
        ...SAMPLE_RECEIPT,
        id: "archived-2",
        isArchived: true,
        archivedAt: new Date("2024-01-15T14:00:00Z"),
      },
      {
        ...SAMPLE_RECEIPT,
        id: "archived-3",
        isArchived: true,
        archivedAt: new Date("2024-01-16T09:00:00Z"),
      },
    ];
    mockPrisma.receipt.findMany.mockResolvedValue(archivedReceipts as any);

    const request = createRequest("/api/receipts/archive");
    const response = await getArchivedReceipts(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body["2024-01-15"]).toHaveLength(2);
    expect(body["2024-01-16"]).toHaveLength(1);

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isArchived: true, userId: "user-123" },
      })
    );
  });

  it("returns all archived receipts for admin users", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findMany.mockResolvedValue([]);

    const request = createRequest("/api/receipts/archive");
    await getArchivedReceipts(request);

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isArchived: true },
      })
    );
  });
});


// ─── Tests: GET /api/receipts/[id]/download ────────────────────────────────────

describe("GET /api/receipts/[id]/download", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/receipts/receipt-001/download");
    const response = await getDownload(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when receipt does not exist", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findUnique.mockResolvedValue(null);

    const request = createRequest("/api/receipts/nonexistent/download");
    const response = await getDownload(request, { params: Promise.resolve({ id: "nonexistent" }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Receipt not found");
  });

  it("returns 403 when non-admin user tries to download another user receipt", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const otherUserReceipt = {
      ...SAMPLE_RECEIPT,
      userId: "other-user-789",
    };
    mockPrisma.receipt.findUnique.mockResolvedValue(otherUserReceipt as any);

    const request = createRequest("/api/receipts/receipt-001/download");
    const response = await getDownload(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Access denied");
  });

  it("returns download URL for the owning user", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findUnique.mockResolvedValue(SAMPLE_RECEIPT as any);

    const request = createRequest("/api/receipts/receipt-001/download");
    const response = await getDownload(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.downloadUrl).toBe("https://fake-s3.example.com/download?signed=true");
    expect(body.filename).toBe("receipt.jpg");
  });

  it("logs admin action when admin downloads a receipt", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findUnique.mockResolvedValue(SAMPLE_RECEIPT as any);
    mockPrisma.adminAction.create.mockResolvedValue({} as any);

    const request = createRequest("/api/receipts/receipt-001/download");
    const response = await getDownload(request, { params: Promise.resolve({ id: "receipt-001" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.downloadUrl).toBeDefined();

    expect(mockPrisma.adminAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-456",
        receiptId: "receipt-001",
        action: "download",
      }),
    });
  });

  it("does not log admin action when regular user downloads", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findUnique.mockResolvedValue(SAMPLE_RECEIPT as any);

    const request = createRequest("/api/receipts/receipt-001/download");
    await getDownload(request, { params: Promise.resolve({ id: "receipt-001" }) });

    expect(mockPrisma.adminAction.create).not.toHaveBeenCalled();
  });
});

// ─── Tests: POST /api/upload/presigned ─────────────────────────────────────────

describe("POST /api/upload/presigned", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createJsonRequest("/api/upload/presigned", {
      fileName: "receipt.jpg",
      contentType: "image/jpeg",
    });
    const response = await getPresignedUploadUrl(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when fileName is missing", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/upload/presigned", {
      contentType: "image/jpeg",
    });
    const response = await getPresignedUploadUrl(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("fileName and contentType are required");
  });

  it("returns 400 when contentType is missing", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/upload/presigned", {
      fileName: "receipt.jpg",
    });
    const response = await getPresignedUploadUrl(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("fileName and contentType are required");
  });

  it("returns 400 for disallowed file types", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/upload/presigned", {
      fileName: "malware.exe",
      contentType: "application/x-msdownload",
    });
    const response = await getPresignedUploadUrl(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("File type not allowed");
  });

  it("returns presigned upload URL for allowed image types", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/upload/presigned", {
      fileName: "receipt.jpg",
      contentType: "image/jpeg",
      isPublic: false,
    });
    const response = await getPresignedUploadUrl(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBe("https://fake-s3.example.com/upload?signed=true");
    expect(body.cloud_storage_path).toBe("uploads/1234567890-test-file.jpg");
  });

  it("returns presigned upload URL for PDF files", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/upload/presigned", {
      fileName: "receipt.pdf",
      contentType: "application/pdf",
    });
    const response = await getPresignedUploadUrl(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploadUrl).toBeDefined();
    expect(body.cloud_storage_path).toBeDefined();
  });

  it("passes isPublic flag to S3 presigned URL generation", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createJsonRequest("/api/upload/presigned", {
      fileName: "public-receipt.png",
      contentType: "image/png",
      isPublic: true,
    });
    await getPresignedUploadUrl(request);

    expect(mockS3.generatePresignedUploadUrl).toHaveBeenCalledWith(
      "public-receipt.png",
      "image/png",
      true
    );
  });
});
