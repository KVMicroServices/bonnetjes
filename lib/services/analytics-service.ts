import { PrismaClient } from "@prisma/client";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface AnalyticsServiceDependencies {
  database: PrismaClient;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HOURS_IN_DAY = 24;
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;

// ─── Types ───────────────────────────────────────────────────────────────────

export type VolumeGranularity = "hour" | "day" | "week";

export interface VolumeDataPoint {
  label: string;
  total: number;
  verified: number;
  rejected: number;
  pending: number;
}

export interface AnalyticsMetrics {
  totalReceipts: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  requiresReviewCount: number;
  flaggedCount: number;
  approvalRate: number;
  rejectionRate: number;
}

export type GetMetricsResult =
  | { success: true; metrics: AnalyticsMetrics }
  | { success: false; error: string };

export type GetVolumeResult =
  | { success: true; data: ReadonlyArray<VolumeDataPoint> }
  | { success: false; error: string };

// ─── Service Functions ───────────────────────────────────────────────────────

/** Fetch high-level receipt metrics for the analytics dashboard. */
export async function getAnalyticsMetrics(
  dependencies: AnalyticsServiceDependencies
): Promise<GetMetricsResult> {
  const database = dependencies.database;

  const [
    totalReceipts,
    approvedCount,
    rejectedCount,
    pendingCount,
    requiresReviewCount,
    flaggedCount,
  ] = await Promise.all([
    database.receipt.count(),
    database.receipt.count({ where: { verificationStatus: "verified" } }),
    database.receipt.count({ where: { verificationStatus: "rejected" } }),
    database.receipt.count({ where: { verificationStatus: "pending" } }),
    database.receipt.count({ where: { verificationStatus: "requires_review" } }),
    database.receipt.count({ where: { verificationStatus: "flagged" } }),
  ]);

  const approvalRate = totalReceipts > 0
    ? Math.round((approvedCount / totalReceipts) * 100)
    : 0;

  const rejectionRate = totalReceipts > 0
    ? Math.round((rejectedCount / totalReceipts) * 100)
    : 0;

  return {
    success: true,
    metrics: {
      totalReceipts,
      approvedCount,
      rejectedCount,
      pendingCount,
      requiresReviewCount,
      flaggedCount,
      approvalRate,
      rejectionRate,
    },
  };
}

/** Fetch receipt volume data grouped by the specified granularity. */
export async function getReceiptVolume(
  dependencies: AnalyticsServiceDependencies,
  granularity: VolumeGranularity
): Promise<GetVolumeResult> {
  const database = dependencies.database;

  const now = new Date();
  let startDate: Date;
  let bucketCount: number;

  if (granularity === "hour") {
    startDate = new Date(now.getTime() - HOURS_IN_DAY * 60 * 60 * 1000);
    bucketCount = HOURS_IN_DAY;
  } else if (granularity === "day") {
    startDate = new Date(now.getTime() - DAYS_IN_MONTH * 24 * 60 * 60 * 1000);
    bucketCount = DAYS_IN_MONTH;
  } else {
    startDate = new Date(now.getTime() - DAYS_IN_WEEK * 7 * 24 * 60 * 60 * 1000);
    bucketCount = DAYS_IN_WEEK;
  }

  const receipts = await database.receipt.findMany({
    where: { createdAt: { gte: startDate } },
    select: {
      createdAt: true,
      verificationStatus: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const dataPoints = buildVolumeDataPoints(receipts, granularity, startDate, now, bucketCount);

  return { success: true, data: dataPoints };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ReceiptSlice {
  createdAt: Date;
  verificationStatus: string;
}

function buildVolumeDataPoints(
  receipts: ReadonlyArray<ReceiptSlice>,
  granularity: VolumeGranularity,
  startDate: Date,
  endDate: Date,
  bucketCount: number
): ReadonlyArray<VolumeDataPoint> {
  const points: VolumeDataPoint[] = [];

  for (let index = 0; index < bucketCount; index++) {
    let bucketStart: Date;
    let bucketEnd: Date;
    let label: string;

    if (granularity === "hour") {
      bucketStart = new Date(startDate.getTime() + index * 60 * 60 * 1000);
      bucketEnd = new Date(bucketStart.getTime() + 60 * 60 * 1000);
      label = bucketStart.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    } else if (granularity === "day") {
      bucketStart = new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000);
      bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
      label = bucketStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    } else {
      bucketStart = new Date(startDate.getTime() + index * 7 * 24 * 60 * 60 * 1000);
      bucketEnd = new Date(bucketStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const weekEndDisplay = new Date(Math.min(bucketEnd.getTime(), endDate.getTime()));
      label = `${bucketStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} - ${weekEndDisplay.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
    }

    const bucketReceipts = receipts.filter((receipt) => {
      return receipt.createdAt >= bucketStart && receipt.createdAt < bucketEnd;
    });

    const total = bucketReceipts.length;
    const verified = bucketReceipts.filter((receipt) => receipt.verificationStatus === "verified").length;
    const rejected = bucketReceipts.filter((receipt) => receipt.verificationStatus === "rejected" || receipt.verificationStatus === "flagged").length;
    const pending = total - verified - rejected;

    points.push({ label, total, verified, rejected, pending });
  }

  return points;
}
