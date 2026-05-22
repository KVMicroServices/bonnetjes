import { PrismaClient } from "@prisma/client";

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface AnalyticsServiceDependencies {
  database: PrismaClient;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HOURS_IN_DAY = 24;
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const PERCENTAGE_MULTIPLIER = 100;

// ─── Types ───────────────────────────────────────────────────────────────────

export type VolumeGranularity = "hour" | "day" | "week";

export interface VolumeDataPoint {
  label: string;
  total: number;
  verified: number;
  rejected: number;
  pending: number;
  requiresReview: number;
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

  let approvalRate = 0;
  if (totalReceipts > 0) {
    approvalRate = Math.round((approvedCount / totalReceipts) * PERCENTAGE_MULTIPLIER);
  }

  let rejectionRate = 0;
  if (totalReceipts > 0) {
    rejectionRate = Math.round((rejectedCount / totalReceipts) * PERCENTAGE_MULTIPLIER);
  }

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

export interface VolumeQueryOptions {
  granularity: VolumeGranularity;
  startDate?: Date;
  endDate?: Date;
}

/** Fetch receipt volume data grouped by the specified granularity. */
export async function getReceiptVolume(
  dependencies: AnalyticsServiceDependencies,
  options: VolumeQueryOptions
): Promise<GetVolumeResult> {
  const database = dependencies.database;

  const granularity = options.granularity;
  const now = new Date();

  const millisecondsPerHour = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
  const millisecondsPerDay = millisecondsPerHour * HOURS_PER_DAY;
  const millisecondsPerWeek = millisecondsPerDay * DAYS_IN_WEEK;

  let startDate: Date;
  let endDate: Date;

  if (options.startDate && options.endDate) {
    startDate = options.startDate;
    endDate = options.endDate;
  } else if (options.startDate) {
    startDate = options.startDate;
    endDate = now;
  } else {
    endDate = now;
    if (granularity === "hour") {
      startDate = new Date(now.getTime() - HOURS_IN_DAY * millisecondsPerHour);
    } else if (granularity === "day") {
      startDate = new Date(now.getTime() - DAYS_IN_MONTH * millisecondsPerDay);
    } else {
      startDate = new Date(now.getTime() - DAYS_IN_WEEK * millisecondsPerWeek);
    }
  }

  const rangeMilliseconds = endDate.getTime() - startDate.getTime();
  let bucketCount: number;

  if (granularity === "hour") {
    bucketCount = Math.ceil(rangeMilliseconds / millisecondsPerHour);
  } else if (granularity === "day") {
    bucketCount = Math.ceil(rangeMilliseconds / millisecondsPerDay);
  } else {
    bucketCount = Math.ceil(rangeMilliseconds / millisecondsPerWeek);
  }

  if (bucketCount < 1) {
    bucketCount = 1;
  }

  const receipts = await database.receipt.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      createdAt: true,
      verificationStatus: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const dataPoints = buildVolumeDataPoints(receipts, granularity, startDate, endDate, bucketCount);

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

    const millisecondsPerHour = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
    const millisecondsPerDay = millisecondsPerHour * HOURS_PER_DAY;
    const millisecondsPerWeek = millisecondsPerDay * DAYS_IN_WEEK;

    if (granularity === "hour") {
      bucketStart = new Date(startDate.getTime() + index * millisecondsPerHour);
      bucketEnd = new Date(bucketStart.getTime() + millisecondsPerHour);
      label = bucketStart.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    } else if (granularity === "day") {
      bucketStart = new Date(startDate.getTime() + index * millisecondsPerDay);
      bucketEnd = new Date(bucketStart.getTime() + millisecondsPerDay);
      label = bucketStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    } else {
      bucketStart = new Date(startDate.getTime() + index * millisecondsPerWeek);
      bucketEnd = new Date(bucketStart.getTime() + millisecondsPerWeek);
      const weekEndDisplay = new Date(Math.min(bucketEnd.getTime(), endDate.getTime()));
      label = `${bucketStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} - ${weekEndDisplay.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
    }

    const bucketReceipts = receipts.filter((receipt) => {
      return receipt.createdAt >= bucketStart && receipt.createdAt < bucketEnd;
    });

    const total = bucketReceipts.length;
    const verifiedReceipts = bucketReceipts.filter((receipt) => receipt.verificationStatus === "verified");
    const verified = verifiedReceipts.length;
    const rejectedReceipts = bucketReceipts.filter((receipt) => receipt.verificationStatus === "rejected" || receipt.verificationStatus === "flagged");
    const rejected = rejectedReceipts.length;
    const requiresReviewReceipts = bucketReceipts.filter((receipt) => receipt.verificationStatus === "requires_review");
    const requiresReview = requiresReviewReceipts.length;
    const pending = total - verified - rejected - requiresReview;

    points.push({ label, total, verified, rejected, pending, requiresReview });
  }

  return points;
}
