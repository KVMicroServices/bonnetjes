import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";
import { PrismaClient } from "@prisma/client";
import {
  listReceipts,
  getReceipt,
  createReceipt,
  updateReceiptStatus,
  archiveReceipts,
  listArchivedReceipts,
  getDownloadUrl,
} from "@/lib/services/receipt-service";
import type {
  StorageClient,
  ReceiptServiceDependencies,
  FraudDetectionModule,
} from "@/lib/services/receipt-service";

// ─── Mock Factories ────────────────────────────────────────────────────────────

function createMockDependencies(): {
  database: DeepMockProxy<PrismaClient>;
  storage: StorageClient;
} {
  return {
    database: mockDeep<PrismaClient>(),
    storage: {
      getFileUrl: vi.fn().mockResolvedValue("https://storage.example.com/signed-url"),
      getFileAsBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-file-content")),
    },
  };
}

function createMockFraudDetection(): FraudDetectionModule {
  return {
    calculateImageHash: vi.fn().mockReturnValue("hash-abc123"),
    checkForDuplicates: vi.fn().mockResolvedValue({ isDuplicate: false }),
    analyzeMetadata: vi.fn().mockReturnValue({ manipulationScore: 0, flags: [] }),
    detectSuspiciousPatterns: vi.fn().mockResolvedValue({ patterns: [], riskScore: 0 }),
    calculateFraudRiskScore: vi.fn().mockReturnValue(5),
  };
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const USER_ID = "user-123";
const ADMIN_ID = "admin-456";
const OTHER_USER_ID = "other-user-789";

const SAMPLE_RECEIPT = {
  id: "receipt-001",
  userId: USER_ID,
  cloudStoragePath: "uploads/receipt.jpg",
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
  ocrConfidence: null,
  ocrReasoning: null,
  receiptReadable: null,
  isArchived: false,
  archivedAt: null,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  queuedAt: null,
  processedAt: null,
  user: { id: USER_ID, name: "Test User", email: "user@example.com" },
};

const OTHER_USER_RECEIPT = {
  ...SAMPLE_RECEIPT,
  id: "receipt-002",
  userId: OTHER_USER_ID,
  user: { id: OTHER_USER_ID, name: "Other User", email: "other@example.com" },
};

// ─── Tests: listReceipts ───────────────────────────────────────────────────────

describe("listReceipts", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns all receipts for admin users", async () => {
    const allReceipts = [SAMPLE_RECEIPT, OTHER_USER_RECEIPT];
    dependencies.database.receipt.findMany.mockResolvedValue(allReceipts as any);

    const result = await listReceipts(dependencies, ADMIN_ID, true);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipts).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    }
    expect(dependencies.database.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it("returns all receipts for non-admin users", async () => {
    const allReceipts = [SAMPLE_RECEIPT, OTHER_USER_RECEIPT];
    dependencies.database.receipt.findMany.mockResolvedValue(allReceipts as any);

    const result = await listReceipts(dependencies, USER_ID, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipts).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    }
    expect(dependencies.database.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it("orders receipts by createdAt descending", async () => {
    dependencies.database.receipt.findMany.mockResolvedValue([]);

    await listReceipts(dependencies, USER_ID, false);

    expect(dependencies.database.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });
});

// ─── Tests: getReceipt ─────────────────────────────────────────────────────────

describe("getReceipt", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns receipt when found and user is owner", async () => {
    const receiptWithActions = { ...SAMPLE_RECEIPT, adminActions: [] };
    dependencies.database.receipt.findUnique.mockResolvedValue(receiptWithActions as any);

    const result = await getReceipt(dependencies, "receipt-001", USER_ID, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipt.id).toBe("receipt-001");
    }
  });

  it("returns receipt for admin regardless of ownership", async () => {
    const receiptWithActions = { ...OTHER_USER_RECEIPT, adminActions: [] };
    dependencies.database.receipt.findUnique.mockResolvedValue(receiptWithActions as any);

    const result = await getReceipt(dependencies, "receipt-002", ADMIN_ID, true);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipt.id).toBe("receipt-002");
    }
  });

  it("returns 404 when receipt does not exist", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(null);

    const result = await getReceipt(dependencies, "nonexistent", USER_ID, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.error).toBe("Receipt not found");
    }
  });

  it("returns receipt for any user regardless of ownership", async () => {
    const receiptWithActions = { ...OTHER_USER_RECEIPT, adminActions: [] };
    dependencies.database.receipt.findUnique.mockResolvedValue(receiptWithActions as any);

    const result = await getReceipt(dependencies, "receipt-002", USER_ID, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipt.id).toBe("receipt-002");
    }
  });
});

// ─── Tests: createReceipt ──────────────────────────────────────────────────────

describe("createReceipt", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;
  let fraudDetection: FraudDetectionModule;

  beforeEach(() => {
    dependencies = createMockDependencies();
    fraudDetection = createMockFraudDetection();
  });

  it("creates receipt with fraud detection pipeline", async () => {
    const createdReceipt = {
      id: "new-receipt",
      userId: USER_ID,
      cloudStoragePath: "uploads/new.jpg",
      isPublic: false,
      originalFilename: "new.jpg",
      fileType: "image",
      fileSize: 100000,
      verificationStatus: "pending",
      imageHash: "hash-abc123",
      isDuplicate: false,
      duplicateOfId: null,
      manipulationScore: 0,
      manipulationFlags: "[]",
      suspiciousPatterns: "[]",
      fraudRiskScore: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dependencies.database.receipt.create.mockResolvedValue(createdReceipt as any);

    const result = await createReceipt(
      dependencies,
      USER_ID,
      {
        cloudStoragePath: "uploads/new.jpg",
        originalFilename: "new.jpg",
        fileType: "image",
        fileSize: 100000,
      },
      fraudDetection
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipt.id).toBe("new-receipt");
    }
    expect(dependencies.storage.getFileAsBuffer).toHaveBeenCalledWith("uploads/new.jpg");
    expect(fraudDetection.calculateImageHash).toHaveBeenCalled();
    expect(fraudDetection.checkForDuplicates).toHaveBeenCalledWith("hash-abc123", USER_ID);
    expect(fraudDetection.analyzeMetadata).toHaveBeenCalled();
    expect(fraudDetection.detectSuspiciousPatterns).toHaveBeenCalledWith(USER_ID, null, null);
    expect(fraudDetection.calculateFraudRiskScore).toHaveBeenCalled();
  });

  it("returns 400 when cloudStoragePath is missing", async () => {
    const result = await createReceipt(
      dependencies,
      USER_ID,
      { cloudStoragePath: "" },
      fraudDetection
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe("Missing cloudStoragePath");
    }
  });

  it("persists fraud analysis results in the database", async () => {
    (fraudDetection.calculateImageHash as ReturnType<typeof vi.fn>).mockReturnValue("detected-hash");
    (fraudDetection.checkForDuplicates as ReturnType<typeof vi.fn>).mockResolvedValue({
      isDuplicate: true,
      duplicateOfId: "existing-receipt",
    });
    (fraudDetection.analyzeMetadata as ReturnType<typeof vi.fn>).mockReturnValue({
      manipulationScore: 30,
      flags: ["EXIF_STRIPPED"],
    });
    (fraudDetection.detectSuspiciousPatterns as ReturnType<typeof vi.fn>).mockResolvedValue({
      patterns: ["HIGH_FREQUENCY"],
      riskScore: 20,
    });
    (fraudDetection.calculateFraudRiskScore as ReturnType<typeof vi.fn>).mockReturnValue(70);

    dependencies.database.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);

    await createReceipt(
      dependencies,
      USER_ID,
      { cloudStoragePath: "uploads/suspicious.jpg" },
      fraudDetection
    );

    expect(dependencies.database.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        imageHash: "detected-hash",
        isDuplicate: true,
        duplicateOfId: "existing-receipt",
        manipulationScore: 30,
        manipulationFlags: JSON.stringify(["EXIF_STRIPPED"]),
        suspiciousPatterns: JSON.stringify(["HIGH_FREQUENCY"]),
        fraudRiskScore: 70,
      }),
    });
  });

  it("still creates receipt when fraud detection throws", async () => {
    (dependencies.storage.getFileAsBuffer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Storage unavailable")
    );
    dependencies.database.receipt.create.mockResolvedValue(SAMPLE_RECEIPT as any);

    const result = await createReceipt(
      dependencies,
      USER_ID,
      { cloudStoragePath: "uploads/file.jpg" },
      fraudDetection
    );

    expect(result.success).toBe(true);
    expect(dependencies.database.receipt.create).toHaveBeenCalled();
  });
});

// ─── Tests: updateReceiptStatus ────────────────────────────────────────────────

describe("updateReceiptStatus", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("updates status and creates admin action log", async () => {
    const updatedReceipt = {
      id: "receipt-001",
      verificationStatus: "approved",
      processedAt: new Date(),
    };
    dependencies.database.receipt.update.mockResolvedValue(updatedReceipt as any);
    dependencies.database.adminAction.create.mockResolvedValue({} as any);

    const result = await updateReceiptStatus(
      dependencies,
      "receipt-001",
      ADMIN_ID,
      "approved",
      "Looks good"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipt.verificationStatus).toBe("approved");
    }

    expect(dependencies.database.receipt.update).toHaveBeenCalledWith({
      where: { id: "receipt-001" },
      data: expect.objectContaining({ verificationStatus: "approved" }),
    });

    expect(dependencies.database.adminAction.create).toHaveBeenCalledWith({
      data: {
        adminId: ADMIN_ID,
        receiptId: "receipt-001",
        action: "approved",
        notes: "Looks good",
      },
    });
  });

  it("creates admin action with undefined notes when not provided", async () => {
    dependencies.database.receipt.update.mockResolvedValue({
      id: "receipt-001",
      verificationStatus: "rejected",
      processedAt: new Date(),
    } as any);
    dependencies.database.adminAction.create.mockResolvedValue({} as any);

    await updateReceiptStatus(dependencies, "receipt-001", ADMIN_ID, "rejected", undefined);

    expect(dependencies.database.adminAction.create).toHaveBeenCalledWith({
      data: {
        adminId: ADMIN_ID,
        receiptId: "receipt-001",
        action: "rejected",
        notes: undefined,
      },
    });
  });
});

// ─── Tests: archiveReceipts ────────────────────────────────────────────────────

describe("archiveReceipts", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("archives receipts for admin without userId filter", async () => {
    dependencies.database.receipt.updateMany.mockResolvedValue({ count: 3 } as any);

    const result = await archiveReceipts(
      dependencies,
      ["receipt-001", "receipt-002", "receipt-003"],
      ADMIN_ID,
      true
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.archivedCount).toBe(3);
    }

    const callArgs = dependencies.database.receipt.updateMany.mock.calls[0][0] as any;
    expect(callArgs.where).not.toHaveProperty("userId");
    expect(callArgs.where.id).toEqual({ in: ["receipt-001", "receipt-002", "receipt-003"] });
    expect(callArgs.where.isArchived).toBe(false);
  });

  it("enforces ownership for non-admin users", async () => {
    dependencies.database.receipt.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await archiveReceipts(
      dependencies,
      ["receipt-001"],
      USER_ID,
      false
    );

    expect(result.success).toBe(true);

    const callArgs = dependencies.database.receipt.updateMany.mock.calls[0][0] as any;
    expect(callArgs.where.userId).toBe(USER_ID);
  });

  it("returns 400 when receiptIds is not an array", async () => {
    const result = await archiveReceipts(
      dependencies,
      null as any,
      USER_ID,
      false
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe("Receipt IDs required");
    }
  });
});

// ─── Tests: listArchivedReceipts ───────────────────────────────────────────────

describe("listArchivedReceipts", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns archived receipts grouped by date", async () => {
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
    dependencies.database.receipt.findMany.mockResolvedValue(archivedReceipts as any);

    const result = await listArchivedReceipts(dependencies, USER_ID, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.grouped["2024-01-15"]).toHaveLength(2);
      expect(result.grouped["2024-01-16"]).toHaveLength(1);
    }
  });

  it("groups receipts with null archivedAt under 'unknown'", async () => {
    const receiptsWithNullDate = [
      {
        ...SAMPLE_RECEIPT,
        id: "archived-null",
        isArchived: true,
        archivedAt: null,
      },
    ];
    dependencies.database.receipt.findMany.mockResolvedValue(receiptsWithNullDate as any);

    const result = await listArchivedReceipts(dependencies, USER_ID, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.grouped["unknown"]).toHaveLength(1);
    }
  });

  it("filters by userId for non-admin users", async () => {
    dependencies.database.receipt.findMany.mockResolvedValue([]);

    await listArchivedReceipts(dependencies, USER_ID, false);

    expect(dependencies.database.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isArchived: true, userId: USER_ID }),
      })
    );
  });

  it("does not filter by userId for admin users", async () => {
    dependencies.database.receipt.findMany.mockResolvedValue([]);

    await listArchivedReceipts(dependencies, ADMIN_ID, true);

    const callArgs = dependencies.database.receipt.findMany.mock.calls[0][0] as any;
    expect(callArgs.where).not.toHaveProperty("userId");
    expect(callArgs.where.isArchived).toBe(true);
  });
});

// ─── Tests: getDownloadUrl ─────────────────────────────────────────────────────

describe("getDownloadUrl", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns download URL for the owning user", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(SAMPLE_RECEIPT as any);

    const result = await getDownloadUrl(dependencies, "receipt-001", USER_ID, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.downloadUrl).toBe("https://storage.example.com/signed-url");
      expect(result.filename).toBe("receipt.jpg");
    }
  });

  it("returns 404 when receipt does not exist", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(null);

    const result = await getDownloadUrl(dependencies, "nonexistent", USER_ID, false);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.error).toBe("Receipt not found");
    }
  });

  it("returns download URL for any authenticated user regardless of ownership", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(OTHER_USER_RECEIPT as any);

    const result = await getDownloadUrl(dependencies, "receipt-002", USER_ID, false);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.downloadUrl).toBe("https://storage.example.com/signed-url");
    }
  });

  it("logs admin action when admin downloads", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(SAMPLE_RECEIPT as any);
    dependencies.database.adminAction.create.mockResolvedValue({} as any);

    const result = await getDownloadUrl(dependencies, "receipt-001", ADMIN_ID, true);

    expect(result.success).toBe(true);
    expect(dependencies.database.adminAction.create).toHaveBeenCalledWith({
      data: {
        adminId: ADMIN_ID,
        receiptId: "receipt-001",
        action: "download",
      },
    });
  });

  it("does not log admin action for regular user downloads", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(SAMPLE_RECEIPT as any);

    await getDownloadUrl(dependencies, "receipt-001", USER_ID, false);

    expect(dependencies.database.adminAction.create).not.toHaveBeenCalled();
  });

  it("passes correct storage path and isPublic flag to storage client", async () => {
    const publicReceipt = { ...SAMPLE_RECEIPT, isPublic: true };
    dependencies.database.receipt.findUnique.mockResolvedValue(publicReceipt as any);

    await getDownloadUrl(dependencies, "receipt-001", USER_ID, false);

    expect(dependencies.storage.getFileUrl).toHaveBeenCalledWith(
      "uploads/receipt.jpg",
      true
    );
  });
});
