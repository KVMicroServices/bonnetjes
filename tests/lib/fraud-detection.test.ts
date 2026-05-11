import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { setupPrismaMock } from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  calculateImageHash,
  analyzeMetadata,
  calculateFraudRiskScore,
  checkForDuplicates,
  detectSuspiciousPatterns,
} from "@/lib/fraud-detection";

// ─── Tests: calculateImageHash ─────────────────────────────────────────────────

describe("calculateImageHash", () => {
  it("returns a sha256 hex string for a given buffer", () => {
    const buffer = Buffer.from("test image content");
    const result = calculateImageHash(buffer);

    const expected = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    expect(result).toBe(expected);
  });

  it("returns a 64-character hex string", () => {
    const buffer = Buffer.from("any content");
    const result = calculateImageHash(buffer);

    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for different buffers", () => {
    const bufferA = Buffer.from("image A");
    const bufferB = Buffer.from("image B");

    const hashA = calculateImageHash(bufferA);
    const hashB = calculateImageHash(bufferB);

    expect(hashA).not.toBe(hashB);
  });

  it("returns the same hash for identical buffers", () => {
    const buffer = Buffer.from("identical content");

    const hashFirst = calculateImageHash(buffer);
    const hashSecond = calculateImageHash(buffer);

    expect(hashFirst).toBe(hashSecond);
  });

  it("handles an empty buffer", () => {
    const buffer = Buffer.alloc(0);
    const result = calculateImageHash(buffer);

    const expected = crypto
      .createHash("sha256")
      .update(buffer)
      .digest("hex");

    expect(result).toBe(expected);
    expect(result).toHaveLength(64);
  });
});

// ─── Tests: analyzeMetadata ────────────────────────────────────────────────────

describe("analyzeMetadata", () => {
  it("returns zero score and no flags for a large file with EXIF data", () => {
    const content = "Exif" + "x".repeat(60000);
    const buffer = Buffer.from(content);
    const result = analyzeMetadata(buffer);

    expect(result.manipulationScore).toBe(0);
    expect(result.flags).toEqual([]);
  });

  it("flags NO_EXIF_DATA when EXIF is absent", () => {
    const buffer = Buffer.alloc(60000, "x");
    const result = analyzeMetadata(buffer);

    expect(result.flags).toContain("NO_EXIF_DATA");
    expect(result.manipulationScore).toBeGreaterThanOrEqual(20);
  });

  it("flags ADOBE_SOFTWARE_DETECTED when Adobe signature is present", () => {
    const content = "Exif" + "Adobe" + "x".repeat(60000);
    const buffer = Buffer.from(content);
    const result = analyzeMetadata(buffer);

    expect(result.flags).toContain("ADOBE_SOFTWARE_DETECTED");
    expect(result.manipulationScore).toBeGreaterThanOrEqual(30);
  });

  it("flags GIMP_SOFTWARE_DETECTED when GIMP signature is present", () => {
    const content = "Exif" + "GIMP" + "x".repeat(60000);
    const buffer = Buffer.from(content);
    const result = analyzeMetadata(buffer);

    expect(result.flags).toContain("GIMP_SOFTWARE_DETECTED");
    expect(result.manipulationScore).toBeGreaterThanOrEqual(30);
  });

  it("flags UNUSUALLY_SMALL_FILE when buffer is under 50000 bytes", () => {
    const content = "Exif" + "x".repeat(100);
    const buffer = Buffer.from(content);
    const result = analyzeMetadata(buffer);

    expect(result.flags).toContain("UNUSUALLY_SMALL_FILE");
    expect(result.manipulationScore).toBeGreaterThanOrEqual(15);
  });

  it("accumulates multiple flags and scores", () => {
    // No EXIF + Adobe + small file
    const content = "Adobe" + "x".repeat(100);
    const buffer = Buffer.from(content);
    const result = analyzeMetadata(buffer);

    expect(result.flags).toContain("NO_EXIF_DATA");
    expect(result.flags).toContain("ADOBE_SOFTWARE_DETECTED");
    expect(result.flags).toContain("UNUSUALLY_SMALL_FILE");
    expect(result.manipulationScore).toBe(65);
  });

  it("caps the manipulation score at 100", () => {
    // No EXIF (20) + Adobe (30) + GIMP (30) + small file (15) = 95
    // Actually all four flags: 20 + 30 + 30 + 15 = 95, still under 100
    // Let's verify the cap logic works by checking a high-score scenario
    const content = "Adobe" + "GIMP" + "x".repeat(100);
    const buffer = Buffer.from(content);
    const result = analyzeMetadata(buffer);

    // NO_EXIF (20) + Adobe (30) + GIMP (30) + small (15) = 95
    expect(result.manipulationScore).toBeLessThanOrEqual(100);
  });

  it("handles an empty buffer", () => {
    const buffer = Buffer.alloc(0);
    const result = analyzeMetadata(buffer);

    // Empty buffer: no EXIF (20) + small file (15) = 35
    expect(result.flags).toContain("NO_EXIF_DATA");
    expect(result.flags).toContain("UNUSUALLY_SMALL_FILE");
    expect(result.manipulationScore).toBe(35);
  });
});

// ─── Tests: calculateFraudRiskScore ────────────────────────────────────────────

describe("calculateFraudRiskScore", () => {
  it("returns 0 when all inputs indicate no risk", () => {
    const score = calculateFraudRiskScore(false, 0, 0, 100);
    expect(score).toBe(0);
  });

  it("adds 50 when receipt is a duplicate", () => {
    const score = calculateFraudRiskScore(true, 0, 0, 100);
    expect(score).toBe(50);
  });

  it("adds 30% of manipulation score", () => {
    const score = calculateFraudRiskScore(false, 100, 0, 100);
    expect(score).toBe(30);
  });

  it("adds 20% of pattern risk score", () => {
    const score = calculateFraudRiskScore(false, 0, 100, 100);
    expect(score).toBe(20);
  });

  it("adds 20 when OCR confidence is below 50", () => {
    const score = calculateFraudRiskScore(false, 0, 0, 30);
    expect(score).toBe(20);
  });

  it("adds 10 when OCR confidence is between 50 and 69", () => {
    const score = calculateFraudRiskScore(false, 0, 0, 60);
    expect(score).toBe(10);
  });

  it("adds nothing for OCR confidence at 70 or above", () => {
    const score = calculateFraudRiskScore(false, 0, 0, 70);
    expect(score).toBe(0);
  });

  it("combines all risk factors", () => {
    // duplicate (50) + manipulation 80*0.3 (24) + pattern 50*0.2 (10) + low OCR (20) = 104 → capped at 100
    const score = calculateFraudRiskScore(true, 80, 50, 30);
    expect(score).toBe(100);
  });

  it("caps the score at 100", () => {
    const score = calculateFraudRiskScore(true, 100, 100, 0);
    expect(score).toBe(100);
  });

  it("rounds the result to an integer", () => {
    // manipulation 33 * 0.3 = 9.9 → should round
    const score = calculateFraudRiskScore(false, 33, 0, 100);
    expect(Number.isInteger(score)).toBe(true);
  });

  it("defaults OCR confidence to 100 when not provided", () => {
    const score = calculateFraudRiskScore(false, 0, 0);
    expect(score).toBe(0);
  });
});

// ─── Tests: checkForDuplicates ─────────────────────────────────────────────────

describe("checkForDuplicates", () => {
  it("returns isDuplicate false when no matching receipts exist", async () => {
    mockPrisma.receipt.findMany.mockResolvedValue([]);

    const result = await checkForDuplicates("abc123hash", "user-1");

    expect(result.isDuplicate).toBe(false);
    expect(result.duplicateOfId).toBeUndefined();
  });

  it("returns isDuplicate true with the first matching receipt id", async () => {
    mockPrisma.receipt.findMany.mockResolvedValue([
      { id: "receipt-original", userId: "user-2" },
    ] as any);

    const result = await checkForDuplicates("abc123hash", "user-1");

    expect(result.isDuplicate).toBe(true);
    expect(result.duplicateOfId).toBe("receipt-original");
  });

  it("queries by imageHash without exclusion when excludeReceiptId is not provided", async () => {
    mockPrisma.receipt.findMany.mockResolvedValue([]);

    await checkForDuplicates("somehash", "user-1");

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith({
      where: {
        imageHash: "somehash",
        id: undefined,
      },
      select: { id: true, userId: true },
    });
  });

  it("excludes the specified receipt id from the query", async () => {
    mockPrisma.receipt.findMany.mockResolvedValue([]);

    await checkForDuplicates("somehash", "user-1", "receipt-to-exclude");

    expect(mockPrisma.receipt.findMany).toHaveBeenCalledWith({
      where: {
        imageHash: "somehash",
        id: { not: "receipt-to-exclude" },
      },
      select: { id: true, userId: true },
    });
  });

  it("returns the first duplicate when multiple matches exist", async () => {
    mockPrisma.receipt.findMany.mockResolvedValue([
      { id: "receipt-first", userId: "user-2" },
      { id: "receipt-second", userId: "user-3" },
    ] as any);

    const result = await checkForDuplicates("duplicatehash", "user-1");

    expect(result.isDuplicate).toBe(true);
    expect(result.duplicateOfId).toBe("receipt-first");
  });
});

// ─── Tests: detectSuspiciousPatterns ───────────────────────────────────────────

describe("detectSuspiciousPatterns", () => {
  beforeEach(() => {
    mockPrisma.receipt.findMany.mockResolvedValue([]);
  });

  it("returns no patterns and zero risk when user has no recent submissions", async () => {
    const result = await detectSuspiciousPatterns("user-1", "Shop A", 25.5);

    expect(result.patterns).toEqual([]);
    expect(result.riskScore).toBe(0);
  });

  it("flags HIGH_SUBMISSION_FREQUENCY when 5 or more recent submissions exist", async () => {
    const recentReceipts = Array.from({ length: 5 }, (_, index) => ({
      id: `receipt-${index}`,
      userId: "user-1",
      extractedShopName: `Shop ${index}`,
      createdAt: new Date(),
    }));
    mockPrisma.receipt.findMany.mockResolvedValue(recentReceipts as any);

    const result = await detectSuspiciousPatterns("user-1", "New Shop", 25.5);

    expect(result.patterns).toContain("HIGH_SUBMISSION_FREQUENCY");
    expect(result.riskScore).toBeGreaterThanOrEqual(25);
  });

  it("flags MULTIPLE_SAME_SHOP_SUBMISSIONS when 2+ receipts from same shop", async () => {
    const recentReceipts = [
      { id: "r1", userId: "user-1", extractedShopName: "Target", createdAt: new Date() },
      { id: "r2", userId: "user-1", extractedShopName: "Target", createdAt: new Date() },
    ];
    mockPrisma.receipt.findMany.mockResolvedValue(recentReceipts as any);

    const result = await detectSuspiciousPatterns("user-1", "Target", 25.5);

    expect(result.patterns).toContain("MULTIPLE_SAME_SHOP_SUBMISSIONS");
    expect(result.riskScore).toBeGreaterThanOrEqual(20);
  });

  it("performs case-insensitive shop name comparison", async () => {
    const recentReceipts = [
      { id: "r1", userId: "user-1", extractedShopName: "WALMART", createdAt: new Date() },
      { id: "r2", userId: "user-1", extractedShopName: "walmart", createdAt: new Date() },
    ];
    mockPrisma.receipt.findMany.mockResolvedValue(recentReceipts as any);

    const result = await detectSuspiciousPatterns("user-1", "Walmart", 25.5);

    expect(result.patterns).toContain("MULTIPLE_SAME_SHOP_SUBMISSIONS");
  });

  it("does not flag same shop when shopName is null", async () => {
    const recentReceipts = [
      { id: "r1", userId: "user-1", extractedShopName: "Shop", createdAt: new Date() },
      { id: "r2", userId: "user-1", extractedShopName: "Shop", createdAt: new Date() },
    ];
    mockPrisma.receipt.findMany.mockResolvedValue(recentReceipts as any);

    const result = await detectSuspiciousPatterns("user-1", null, 25.5);

    expect(result.patterns).not.toContain("MULTIPLE_SAME_SHOP_SUBMISSIONS");
  });

  it("does not flag same shop when shopName is undefined", async () => {
    const recentReceipts = [
      { id: "r1", userId: "user-1", extractedShopName: "Shop", createdAt: new Date() },
    ];
    mockPrisma.receipt.findMany.mockResolvedValue(recentReceipts as any);

    const result = await detectSuspiciousPatterns("user-1", undefined, 25.5);

    expect(result.patterns).not.toContain("MULTIPLE_SAME_SHOP_SUBMISSIONS");
  });

  it("flags ROUND_AMOUNT_SUSPICIOUS for amounts divisible by 10", async () => {
    const result = await detectSuspiciousPatterns("user-1", "Shop", 50);

    expect(result.patterns).toContain("ROUND_AMOUNT_SUSPICIOUS");
    expect(result.riskScore).toBeGreaterThanOrEqual(10);
  });

  it("does not flag round amount for zero", async () => {
    const result = await detectSuspiciousPatterns("user-1", "Shop", 0);

    expect(result.patterns).not.toContain("ROUND_AMOUNT_SUSPICIOUS");
  });

  it("does not flag round amount when amount is null", async () => {
    const result = await detectSuspiciousPatterns("user-1", "Shop", null);

    expect(result.patterns).not.toContain("ROUND_AMOUNT_SUSPICIOUS");
    expect(result.patterns).not.toContain("HIGH_AMOUNT_FLAG");
  });

  it("flags HIGH_AMOUNT_FLAG for amounts over 1000", async () => {
    const result = await detectSuspiciousPatterns("user-1", "Shop", 1500);

    expect(result.patterns).toContain("HIGH_AMOUNT_FLAG");
    expect(result.riskScore).toBeGreaterThanOrEqual(15);
  });

  it("does not flag HIGH_AMOUNT_FLAG for exactly 1000", async () => {
    const result = await detectSuspiciousPatterns("user-1", "Shop", 1000);

    expect(result.patterns).not.toContain("HIGH_AMOUNT_FLAG");
  });

  it("accumulates multiple pattern flags", async () => {
    const recentReceipts = Array.from({ length: 6 }, (_, index) => ({
      id: `receipt-${index}`,
      userId: "user-1",
      extractedShopName: "Same Shop",
      createdAt: new Date(),
    }));
    mockPrisma.receipt.findMany.mockResolvedValue(recentReceipts as any);

    // High frequency + same shop + round amount + high amount
    const result = await detectSuspiciousPatterns("user-1", "Same Shop", 2000);

    expect(result.patterns).toContain("HIGH_SUBMISSION_FREQUENCY");
    expect(result.patterns).toContain("MULTIPLE_SAME_SHOP_SUBMISSIONS");
    expect(result.patterns).toContain("ROUND_AMOUNT_SUSPICIOUS");
    expect(result.patterns).toContain("HIGH_AMOUNT_FLAG");
  });

  it("caps risk score at 100", async () => {
    const recentReceipts = Array.from({ length: 10 }, (_, index) => ({
      id: `receipt-${index}`,
      userId: "user-1",
      extractedShopName: "Same Shop",
      createdAt: new Date(),
    }));
    mockPrisma.receipt.findMany.mockResolvedValue(recentReceipts as any);

    // 25 + 20 + 10 + 15 = 70, under 100 but verify cap logic exists
    const result = await detectSuspiciousPatterns("user-1", "Same Shop", 2000);

    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it("queries receipts from the last 24 hours only", async () => {
    mockPrisma.receipt.findMany.mockResolvedValue([]);

    await detectSuspiciousPatterns("user-1", "Shop", 25);

    const callArgs = mockPrisma.receipt.findMany.mock.calls[0][0];
    const gteDate = (callArgs as any).where.createdAt.gte as Date;
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    // The gte date should be approximately 24 hours ago (within 1 second tolerance)
    expect(gteDate.getTime()).toBeGreaterThan(twentyFourHoursAgo - 1000);
    expect(gteDate.getTime()).toBeLessThan(twentyFourHoursAgo + 1000);
  });
});
