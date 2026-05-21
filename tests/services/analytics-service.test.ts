import { describe, it, expect, vi } from "vitest";
import {
  getAnalyticsMetrics,
  getReceiptVolume,
  AnalyticsServiceDependencies,
} from "@/lib/services/analytics-service";

// ─── Mock Database ───────────────────────────────────────────────────────────

function createMockDatabase(overrides: {
  totalCount?: number;
  verifiedCount?: number;
  rejectedCount?: number;
  pendingCount?: number;
  requiresReviewCount?: number;
  flaggedCount?: number;
  receipts?: Array<{ createdAt: Date; verificationStatus: string }>;
}) {
  const countMock = vi.fn();

  countMock.mockImplementation(({ where } = {}) => {
    if (!where) {
      return Promise.resolve(overrides.totalCount ?? 0);
    }
    const status = where.verificationStatus;
    if (status === "verified") {
      return Promise.resolve(overrides.verifiedCount ?? 0);
    }
    if (status === "rejected") {
      return Promise.resolve(overrides.rejectedCount ?? 0);
    }
    if (status === "pending") {
      return Promise.resolve(overrides.pendingCount ?? 0);
    }
    if (status === "requires_review") {
      return Promise.resolve(overrides.requiresReviewCount ?? 0);
    }
    if (status === "flagged") {
      return Promise.resolve(overrides.flaggedCount ?? 0);
    }
    return Promise.resolve(0);
  });

  const findManyMock = vi.fn().mockResolvedValue(overrides.receipts ?? []);

  return {
    receipt: {
      count: countMock,
      findMany: findManyMock,
    },
  } as unknown as AnalyticsServiceDependencies["database"];
}

// ─── Tests: getAnalyticsMetrics ──────────────────────────────────────────────

describe("getAnalyticsMetrics", () => {
  it("returns correct counts and rates", async () => {
    const database = createMockDatabase({
      totalCount: 100,
      verifiedCount: 60,
      rejectedCount: 20,
      pendingCount: 10,
      requiresReviewCount: 5,
      flaggedCount: 5,
    });

    const result = await getAnalyticsMetrics({ database });

    if (!result.success) {
      throw new Error("Expected success");
    }

    expect(result.metrics.totalReceipts).toBe(100);
    expect(result.metrics.approvedCount).toBe(60);
    expect(result.metrics.rejectedCount).toBe(20);
    expect(result.metrics.pendingCount).toBe(10);
    expect(result.metrics.requiresReviewCount).toBe(5);
    expect(result.metrics.flaggedCount).toBe(5);
    expect(result.metrics.approvalRate).toBe(60);
    expect(result.metrics.rejectionRate).toBe(20);
  });

  it("returns zero rates when no receipts exist", async () => {
    const database = createMockDatabase({
      totalCount: 0,
      verifiedCount: 0,
      rejectedCount: 0,
      pendingCount: 0,
      requiresReviewCount: 0,
      flaggedCount: 0,
    });

    const result = await getAnalyticsMetrics({ database });

    if (!result.success) {
      throw new Error("Expected success");
    }

    expect(result.metrics.approvalRate).toBe(0);
    expect(result.metrics.rejectionRate).toBe(0);
  });
});

// ─── Tests: getReceiptVolume ─────────────────────────────────────────────────

describe("getReceiptVolume", () => {
  it("returns 24 data points for hourly granularity", async () => {
    const database = createMockDatabase({ receipts: [] });

    const result = await getReceiptVolume({ database }, { granularity: "hour" });

    if (!result.success) {
      throw new Error("Expected success");
    }

    expect(result.data).toHaveLength(24);
  });

  it("returns 30 data points for daily granularity", async () => {
    const database = createMockDatabase({ receipts: [] });

    const result = await getReceiptVolume({ database }, { granularity: "day" });

    if (!result.success) {
      throw new Error("Expected success");
    }

    expect(result.data).toHaveLength(30);
  });

  it("returns 7 data points for weekly granularity", async () => {
    const database = createMockDatabase({ receipts: [] });

    const result = await getReceiptVolume({ database }, { granularity: "week" });

    if (!result.success) {
      throw new Error("Expected success");
    }

    expect(result.data).toHaveLength(7);
  });

  it("correctly buckets receipts by status", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);

    const receipts = [
      { createdAt: oneHourAgo, verificationStatus: "verified" },
      { createdAt: oneHourAgo, verificationStatus: "verified" },
      { createdAt: oneHourAgo, verificationStatus: "rejected" },
      { createdAt: oneHourAgo, verificationStatus: "pending" },
      { createdAt: oneHourAgo, verificationStatus: "requires_review" },
    ];

    const database = createMockDatabase({ receipts });

    const result = await getReceiptVolume({ database }, { granularity: "hour" });

    if (!result.success) {
      throw new Error("Expected success");
    }

    const totalVerified = result.data.reduce((sum, point) => sum + point.verified, 0);
    const totalRejected = result.data.reduce((sum, point) => sum + point.rejected, 0);
    const totalPending = result.data.reduce((sum, point) => sum + point.pending, 0);
    const totalRequiresReview = result.data.reduce((sum, point) => sum + point.requiresReview, 0);

    expect(totalVerified).toBe(2);
    expect(totalRejected).toBe(1);
    expect(totalPending).toBe(1);
    expect(totalRequiresReview).toBe(1);
  });

  it("respects custom date range", async () => {
    const database = createMockDatabase({ receipts: [] });

    const startDate = new Date("2026-05-01T00:00:00");
    const endDate = new Date("2026-05-01T23:59:59");

    const result = await getReceiptVolume({ database }, {
      granularity: "hour",
      startDate,
      endDate,
    });

    if (!result.success) {
      throw new Error("Expected success");
    }

    expect(result.data).toHaveLength(24);
  });
});
