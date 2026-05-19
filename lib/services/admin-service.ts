import { PrismaClient } from "@prisma/client";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface AdminServiceDependencies {
  database: PrismaClient;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPER_ADMIN_EMAILS: ReadonlyArray<string> = ["marketing@kiyoh.co.za"];

const VALID_ROLES: ReadonlyArray<string> = ["user", "admin"];

const RECENT_ACTIONS_LIMIT = 10;

const HIGH_RISK_SCORE_THRESHOLD = 50;

// ─── Result Types ────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalReceipts: number;
  pendingCount: number;
  verifiedCount: number;
  rejectedCount: number;
  totalUsers: number;
  fraudStats: {
    averageRiskScore: number;
    duplicateCount: number;
    highRiskCount: number;
  };
  recentActions: ReadonlyArray<{
    id: string;
    adminId: string;
    receiptId: string;
    action: string;
    notes: string | null;
    createdAt: Date;
    admin: { name: string | null; email: string };
    receipt: { id: string; extractedShopName: string | null };
  }>;
}

export interface UserWithReceiptCount {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: Date;
  _count: { receipts: number };
}

export interface UpdatedUser {
  id: string;
  email: string;
  role: string;
}

export type GetDashboardStatsResult =
  | { success: true; stats: DashboardStats }
  | { success: false; error: string };

export type ListUsersResult =
  | { success: true; users: ReadonlyArray<UserWithReceiptCount> }
  | { success: false; error: string };

export type UpdateUserRoleResult =
  | { success: true; user: UpdatedUser }
  | { success: false; error: string; statusCode: number };

// ─── Service Functions ───────────────────────────────────────────────────────

/** Fetch aggregated dashboard statistics including receipt counts, user count, and fraud metrics. */
export async function getDashboardStats(
  dependencies: AdminServiceDependencies
): Promise<GetDashboardStatsResult> {
  const database = dependencies.database;

  const [
    totalReceipts,
    pendingCount,
    verifiedCount,
    rejectedCount,
    totalUsers,
    recentActions,
  ] = await Promise.all([
    database.receipt.count(),
    database.receipt.count({ where: { verificationStatus: { in: ["pending", "requires_review"] } } }),
    database.receipt.count({ where: { verificationStatus: "verified" } }),
    database.receipt.count({
      where: { verificationStatus: { in: ["rejected", "flagged"] } },
    }),
    database.user.count({ where: { role: "user" } }),
    database.adminAction.findMany({
      take: RECENT_ACTIONS_LIMIT,
      orderBy: { createdAt: "desc" },
      include: {
        admin: { select: { name: true, email: true } },
        receipt: { select: { id: true, extractedShopName: true } },
      },
    }),
  ]);

  const fraudAggregate = await database.receipt.aggregate({
    _avg: { fraudRiskScore: true },
    _count: { _all: true },
  });

  const duplicateCount = await database.receipt.count({
    where: { isDuplicate: true },
  });

  const highRiskCount = await database.receipt.count({
    where: { fraudRiskScore: { gte: HIGH_RISK_SCORE_THRESHOLD } },
  });

  const averageRiskScoreRaw = fraudAggregate._avg.fraudRiskScore;
  const averageRiskScore = averageRiskScoreRaw
    ? Math.round(averageRiskScoreRaw)
    : 0;

  const stats: DashboardStats = {
    totalReceipts,
    pendingCount,
    verifiedCount,
    rejectedCount,
    totalUsers,
    fraudStats: {
      averageRiskScore,
      duplicateCount,
      highRiskCount,
    },
    recentActions,
  };

  return { success: true, stats };
}

/** List all users with their receipt counts, ordered by creation date descending. */
export async function listUsers(
  dependencies: AdminServiceDependencies
): Promise<ListUsersResult> {
  const database = dependencies.database;

  const users = await database.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      _count: { select: { receipts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { success: true, users };
}

/** Update a user's role with super-admin protection. */
export async function updateUserRole(
  dependencies: AdminServiceDependencies,
  targetUserId: string,
  newRole: string
): Promise<UpdateUserRoleResult> {
  const database = dependencies.database;

  if (!targetUserId || !VALID_ROLES.includes(newRole)) {
    return { success: false, error: "Invalid request", statusCode: 400 };
  }

  const targetUser = await database.user.findUnique({
    where: { id: targetUserId },
    select: { email: true },
  });

  if (!targetUser) {
    return { success: false, error: "User not found", statusCode: 404 };
  }

  const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(targetUser.email);
  if (isSuperAdmin && newRole !== "admin") {
    return {
      success: false,
      error: "Cannot demote this user",
      statusCode: 403,
    };
  }

  const updatedUser = await database.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
    select: { id: true, email: true, role: true },
  });

  return { success: true, user: updatedUser };
}
