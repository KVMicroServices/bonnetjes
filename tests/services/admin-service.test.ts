import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, DeepMockProxy } from "vitest-mock-extended";
import { PrismaClient } from "@prisma/client";
import {
  getDashboardStats,
  listUsers,
  updateUserRole,
} from "@/lib/services/admin-service";
import type { AdminServiceDependencies } from "@/lib/services/admin-service";

// ─── Mock Factories ────────────────────────────────────────────────────────────

function createMockDependencies(): {
  database: DeepMockProxy<PrismaClient>;
} {
  return {
    database: mockDeep<PrismaClient>(),
  };
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SUPER_ADMIN_EMAIL = "marketing@kiyoh.co.za";

const SAMPLE_ADMIN_ACTION = {
  id: "action-001",
  adminId: "admin-123",
  receiptId: "receipt-001",
  action: "approved",
  notes: "Verified manually",
  createdAt: new Date("2024-01-15T10:00:00Z"),
  admin: { name: "Admin User", email: "admin@example.com" },
  receipt: { id: "receipt-001", extractedShopName: "Test Shop" },
};

const SAMPLE_USER = {
  id: "user-001",
  name: "Test User",
  email: "user@example.com",
  role: "user",
  createdAt: new Date("2024-01-10T08:00:00Z"),
  _count: { receipts: 5 },
};

// ─── Tests: getDashboardStats ──────────────────────────────────────────────────

describe("getDashboardStats", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns aggregated dashboard statistics", async () => {
    dependencies.database.receipt.count
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(40 as never)
      .mockResolvedValueOnce(50 as never)
      .mockResolvedValueOnce(10 as never)
      .mockResolvedValueOnce(3 as never)
      .mockResolvedValueOnce(7 as never);

    dependencies.database.user.count.mockResolvedValue(25 as never);
    dependencies.database.adminAction.findMany.mockResolvedValue([SAMPLE_ADMIN_ACTION] as never);
    dependencies.database.receipt.aggregate.mockResolvedValue({
      _avg: { fraudRiskScore: 22.5 },
      _count: { _all: 100 },
    } as never);

    const result = await getDashboardStats(dependencies);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.stats.totalReceipts).toBe(100);
      expect(result.stats.pendingCount).toBe(40);
      expect(result.stats.verifiedCount).toBe(50);
      expect(result.stats.rejectedCount).toBe(10);
      expect(result.stats.totalUsers).toBe(25);
      expect(result.stats.fraudStats.averageRiskScore).toBe(23);
      expect(result.stats.fraudStats.duplicateCount).toBe(3);
      expect(result.stats.fraudStats.highRiskCount).toBe(7);
      expect(result.stats.recentActions).toHaveLength(1);
      expect(result.stats.recentActions[0].id).toBe("action-001");
    }
  });

  it("returns zero average risk score when no receipts have scores", async () => {
    dependencies.database.receipt.count.mockResolvedValue(0 as never);
    dependencies.database.user.count.mockResolvedValue(0 as never);
    dependencies.database.adminAction.findMany.mockResolvedValue([] as never);
    dependencies.database.receipt.aggregate.mockResolvedValue({
      _avg: { fraudRiskScore: null },
      _count: { _all: 0 },
    } as never);

    const result = await getDashboardStats(dependencies);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.stats.fraudStats.averageRiskScore).toBe(0);
    }
  });
});

// ─── Tests: listUsers ──────────────────────────────────────────────────────────

describe("listUsers", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("returns users with receipt counts ordered by createdAt desc", async () => {
    const users = [
      SAMPLE_USER,
      { ...SAMPLE_USER, id: "user-002", email: "second@example.com", _count: { receipts: 2 } },
    ];
    dependencies.database.user.findMany.mockResolvedValue(users as never);

    const result = await listUsers(dependencies);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.users).toHaveLength(2);
      expect(result.users[0]._count.receipts).toBe(5);
    }

    expect(dependencies.database.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        select: expect.objectContaining({
          _count: { select: { receipts: true } },
        }),
      })
    );
  });

  it("returns empty array when no users exist", async () => {
    dependencies.database.user.findMany.mockResolvedValue([] as never);

    const result = await listUsers(dependencies);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.users).toHaveLength(0);
    }
  });
});

// ─── Tests: updateUserRole ─────────────────────────────────────────────────────

describe("updateUserRole", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    dependencies = createMockDependencies();
  });

  it("updates user role successfully", async () => {
    dependencies.database.user.findUnique.mockResolvedValue({
      email: "user@example.com",
    } as never);
    dependencies.database.user.update.mockResolvedValue({
      id: "user-001",
      email: "user@example.com",
      role: "admin",
    } as never);

    const result = await updateUserRole(dependencies, "user-001", "admin");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.role).toBe("admin");
      expect(result.user.id).toBe("user-001");
    }
  });

  it("returns 404 when user is not found", async () => {
    dependencies.database.user.findUnique.mockResolvedValue(null as never);

    const result = await updateUserRole(dependencies, "nonexistent", "admin");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(404);
      expect(result.error).toBe("User not found");
    }
  });

  it("returns 400 for invalid role", async () => {
    const result = await updateUserRole(dependencies, "user-001", "superadmin");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe("Invalid request");
    }
  });

  it("returns 400 when targetUserId is empty", async () => {
    const result = await updateUserRole(dependencies, "", "admin");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe("Invalid request");
    }
  });

  it("returns 403 when attempting to demote a super-admin", async () => {
    dependencies.database.user.findUnique.mockResolvedValue({
      email: SUPER_ADMIN_EMAIL,
    } as never);

    const result = await updateUserRole(dependencies, "super-admin-id", "user");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(403);
      expect(result.error).toBe("Cannot demote this user");
    }
  });

  it("allows setting super-admin role to admin (no-op role)", async () => {
    dependencies.database.user.findUnique.mockResolvedValue({
      email: SUPER_ADMIN_EMAIL,
    } as never);
    dependencies.database.user.update.mockResolvedValue({
      id: "super-admin-id",
      email: SUPER_ADMIN_EMAIL,
      role: "admin",
    } as never);

    const result = await updateUserRole(dependencies, "super-admin-id", "admin");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.role).toBe("admin");
    }
  });
});
