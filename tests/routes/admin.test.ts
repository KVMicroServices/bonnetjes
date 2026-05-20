import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupPrismaMock,
  createUserSession,
  createAdminSession,
} from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();

// Mock next-auth session
const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// Mock audit-log-service (fire-and-forget, not relevant to these tests)
vi.mock("@/lib/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET as getAdminReceipts, PATCH as patchAdminReceipt } from "@/app/api/admin/receipts/route";
import { GET as getAdminUsers, PATCH as patchAdminUser } from "@/app/api/admin/users/route";
import { GET as getAdminStats } from "@/app/api/admin/stats/route";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_RECEIPT = {
  id: "receipt-001",
  userId: "user-123",
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
  extractedShopName: "Test Shop",
  extractedDate: null,
  extractedAmount: null,
  isArchived: false,
  archivedAt: null,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  queuedAt: null,
  processedAt: null,
  user: { id: "user-123", name: "Test User", email: "user@example.com" },
};

const SAMPLE_USER = {
  id: "user-123",
  name: "Test User",
  email: "user@example.com",
  role: "user",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  _count: { receipts: 5 },
};

const SUPER_ADMIN_USER = {
  id: "super-admin-001",
  name: "Super Admin",
  email: "marketing@kiyoh.co.za",
  role: "admin",
  createdAt: new Date("2023-06-01T00:00:00Z"),
  _count: { receipts: 0 },
};

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options as Record<string, unknown>);
}

function createPatchRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests: GET /api/admin/receipts ────────────────────────────────────────────

describe("GET /api/admin/receipts", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await getAdminReceipts();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const response = await getAdminReceipts();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns all receipts with user info for admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findMany.mockResolvedValue([SAMPLE_RECEIPT] as any);

    const response = await getAdminReceipts();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("receipt-001");
    expect(body[0].user.email).toBe("user@example.com");
  });

  it("returns receipts ordered by createdAt descending", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.findMany.mockResolvedValue([]);

    await getAdminReceipts();

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      })
    );
  });
});

// ─── Tests: PATCH /api/admin/receipts ──────────────────────────────────────────

describe("PATCH /api/admin/receipts", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest("/api/admin/receipts", {
      id: "receipt-001",
      verificationStatus: "verified",
    });
    const response = await patchAdminReceipt(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest("/api/admin/receipts", {
      id: "receipt-001",
      verificationStatus: "verified",
    });
    const response = await patchAdminReceipt(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("updates receipt verification status for admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const updatedReceipt = {
      ...SAMPLE_RECEIPT,
      verificationStatus: "verified",
    };
    mockPrisma.receipt.update.mockResolvedValue(updatedReceipt as any);

    const request = createPatchRequest("/api/admin/receipts", {
      id: "receipt-001",
      verificationStatus: "verified",
    });
    const response = await patchAdminReceipt(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verificationStatus).toBe("verified");

    expect(mockPrisma.receipt.update).toHaveBeenCalledWith({
      where: { id: "receipt-001" },
      data: { verificationStatus: "verified" },
    });
  });
});

// ─── Tests: GET /api/admin/users ───────────────────────────────────────────────

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await getAdminUsers();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const response = await getAdminUsers();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns all users with receipt counts for admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.user.findMany.mockResolvedValue([SAMPLE_USER, SUPER_ADMIN_USER] as any);

    const response = await getAdminUsers();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].email).toBe("user@example.com");
    expect(body[0]._count.receipts).toBe(5);
  });

  it("returns users ordered by createdAt descending", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.user.findMany.mockResolvedValue([]);

    await getAdminUsers();

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        select: expect.objectContaining({
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          _count: { select: { receipts: true } },
        }),
      })
    );
  });
});

// ─── Tests: PATCH /api/admin/users ─────────────────────────────────────────────

describe("PATCH /api/admin/users", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest("/api/admin/users", {
      userId: "user-123",
      role: "admin",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest("/api/admin/users", {
      userId: "user-123",
      role: "admin",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when userId is missing", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest("/api/admin/users", {
      role: "admin",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  it("returns 400 when role is invalid", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPatchRequest("/api/admin/users", {
      userId: "user-123",
      role: "superadmin",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });

  it("returns 403 when trying to demote a super-admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.user.findUnique.mockResolvedValue({
      email: "marketing@kiyoh.co.za",
    } as any);

    const request = createPatchRequest("/api/admin/users", {
      userId: "super-admin-001",
      role: "user",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Cannot demote this user");
  });

  it("allows keeping super-admin as admin role", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.user.findUnique.mockResolvedValue({
      email: "marketing@kiyoh.co.za",
    } as any);

    const updatedUser = {
      id: "super-admin-001",
      email: "marketing@kiyoh.co.za",
      role: "admin",
    };
    mockPrisma.user.update.mockResolvedValue(updatedUser as any);

    const request = createPatchRequest("/api/admin/users", {
      userId: "super-admin-001",
      role: "admin",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.role).toBe("admin");
  });

  it("updates a regular user role to admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.user.findUnique.mockResolvedValue({
      email: "user@example.com",
    } as any);

    const updatedUser = {
      id: "user-123",
      email: "user@example.com",
      role: "admin",
    };
    mockPrisma.user.update.mockResolvedValue(updatedUser as any);

    const request = createPatchRequest("/api/admin/users", {
      userId: "user-123",
      role: "admin",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("user-123");
    expect(body.role).toBe("admin");

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-123" },
      data: { role: "admin" },
      select: { id: true, email: true, role: true },
    });
  });

  it("demotes a regular admin to user role", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.user.findUnique.mockResolvedValue({
      email: "other-admin@example.com",
    } as any);

    const updatedUser = {
      id: "admin-789",
      email: "other-admin@example.com",
      role: "user",
    };
    mockPrisma.user.update.mockResolvedValue(updatedUser as any);

    const request = createPatchRequest("/api/admin/users", {
      userId: "admin-789",
      role: "user",
    });
    const response = await patchAdminUser(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.role).toBe("user");
  });
});

// ─── Tests: GET /api/admin/stats ───────────────────────────────────────────────

describe("GET /api/admin/stats", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/admin/stats");
    const response = await getAdminStats(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createRequest("/api/admin/stats");
    const response = await getAdminStats(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Admin access required");
  });

  it("returns dashboard stats for admin", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.count
      .mockResolvedValueOnce(100 as any)
      .mockResolvedValueOnce(25 as any)
      .mockResolvedValueOnce(60 as any)
      .mockResolvedValueOnce(15 as any);

    mockPrisma.user.count.mockResolvedValue(42 as any);

    mockPrisma.adminAction.findMany.mockResolvedValue([
      {
        id: "action-1",
        action: "approved",
        createdAt: new Date("2024-01-15T10:00:00Z"),
        admin: { name: "Admin User", email: "admin@example.com" },
        receipt: { id: "receipt-001", extractedShopName: "Test Shop" },
      },
    ] as any);

    mockPrisma.receipt.aggregate.mockResolvedValue({
      _avg: { fraudRiskScore: 12.5 },
      _count: { _all: 100 },
    } as any);

    mockPrisma.receipt.count
      .mockResolvedValueOnce(3 as any)
      .mockResolvedValueOnce(7 as any);

    const request = createRequest("/api/admin/stats");
    const response = await getAdminStats(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totalReceipts).toBe(100);
    expect(body.pendingCount).toBe(25);
    expect(body.verifiedCount).toBe(60);
    expect(body.rejectedCount).toBe(15);
    expect(body.totalUsers).toBe(42);
    expect(body.fraudStats).toBeDefined();
    expect(body.fraudStats.averageRiskScore).toBe(13);
    expect(body.fraudStats.duplicateCount).toBe(3);
    expect(body.fraudStats.highRiskCount).toBe(7);
    expect(body.recentActions).toHaveLength(1);
  });

  it("handles zero fraud risk score average gracefully", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    mockPrisma.receipt.count
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any);

    mockPrisma.user.count.mockResolvedValue(0 as any);
    mockPrisma.adminAction.findMany.mockResolvedValue([] as any);

    mockPrisma.receipt.aggregate.mockResolvedValue({
      _avg: { fraudRiskScore: null },
      _count: { _all: 0 },
    } as any);

    mockPrisma.receipt.count
      .mockResolvedValueOnce(0 as any)
      .mockResolvedValueOnce(0 as any);

    const request = createRequest("/api/admin/stats");
    const response = await getAdminStats(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.fraudStats.averageRiskScore).toBe(0);
    expect(body.fraudStats.duplicateCount).toBe(0);
    expect(body.fraudStats.highRiskCount).toBe(0);
  });
});
