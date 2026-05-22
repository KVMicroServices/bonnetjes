import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupPrismaMock } from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
    ReviewDisableEmail: {
      subject: "Update on your review — proof of purchase rejected",
      headerTagline: "Update on your review",
      headerTitle: "Proof of purchase rejected",
      greeting: "Hi there,",
      intro: "Unfortunately, your uploaded proof of purchase did not meet our requirements.",
    },
    ReceiptVerifiedEmail: {
      subject: "Your receipt has been verified",
      headerTagline: "Great news",
      headerTitle: "Receipt verified",
      greeting: "Hi there,",
      body: "Your receipt has been successfully verified.",
    },
    DisputeVerifiedEmail: {
      subject: "Your dispute has been resolved",
      headerTagline: "Good news",
      headerTitle: "Dispute resolved",
      greeting: "Hi there,",
      body: "Your dispute has been resolved in your favor.",
    },
    DisputeFinalRejectionEmail: {
      subject: "Final decision on your dispute",
      headerTagline: "Update on your dispute",
      headerTitle: "Dispute rejected",
      greeting: "Hi there,",
      body: "After careful review, your dispute has been rejected.",
    },
  })),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  getOverridesForEmailType,
  upsertOverride,
  deleteOverride,
  bulkUpsertOverrides,
  getDefaultValues,
} from "@/lib/services/email-template-override-service";

// ─── Tests: getOverridesForEmailType ───────────────────────────────────────────

describe("getOverridesForEmailType", () => {
  it("returns a key-value map of overrides from the database", async () => {
    mockPrisma.emailTemplateOverride.findMany.mockResolvedValue([
      { id: "1", emailType: "disable", key: "subject", locale: "en", value: "Custom subject", createdAt: new Date(), updatedAt: new Date() },
      { id: "2", emailType: "disable", key: "greeting", locale: "en", value: "Hello!", createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await getOverridesForEmailType("disable", "en");

    expect(result).toEqual({
      subject: "Custom subject",
      greeting: "Hello!",
    });
    expect(mockPrisma.emailTemplateOverride.findMany).toHaveBeenCalledWith({
      where: { emailType: "disable", locale: "en" },
    });
  });

  it("returns an empty map when no overrides exist", async () => {
    mockPrisma.emailTemplateOverride.findMany.mockResolvedValue([]);

    const result = await getOverridesForEmailType("verified", "nl");

    expect(result).toEqual({});
  });

  it("returns an empty map and logs error on database failure", async () => {
    mockPrisma.emailTemplateOverride.findMany.mockRejectedValue(new Error("Connection refused"));

    const result = await getOverridesForEmailType("disable", "en");

    expect(result).toEqual({});
  });
});

// ─── Tests: upsertOverride ─────────────────────────────────────────────────────

describe("upsertOverride", () => {
  it("calls prisma upsert with correct parameters", async () => {
    mockPrisma.emailTemplateOverride.upsert.mockResolvedValue({
      id: "1",
      emailType: "disable",
      key: "subject",
      locale: "en",
      value: "New subject",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await upsertOverride("disable", "subject", "en", "New subject");

    expect(mockPrisma.emailTemplateOverride.upsert).toHaveBeenCalledWith({
      where: {
        emailType_key_locale: { emailType: "disable", key: "subject", locale: "en" },
      },
      update: { value: "New subject" },
      create: { emailType: "disable", key: "subject", locale: "en", value: "New subject" },
    });
  });

  it("throws on database failure", async () => {
    mockPrisma.emailTemplateOverride.upsert.mockRejectedValue(new Error("DB write failed"));

    await expect(upsertOverride("disable", "subject", "en", "value")).rejects.toThrow("DB write failed");
  });
});

// ─── Tests: deleteOverride ─────────────────────────────────────────────────────

describe("deleteOverride", () => {
  it("calls prisma delete with the correct composite key", async () => {
    mockPrisma.emailTemplateOverride.delete.mockResolvedValue({
      id: "1",
      emailType: "disable",
      key: "subject",
      locale: "en",
      value: "Old value",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await deleteOverride("disable", "subject", "en");

    expect(mockPrisma.emailTemplateOverride.delete).toHaveBeenCalledWith({
      where: {
        emailType_key_locale: { emailType: "disable", key: "subject", locale: "en" },
      },
    });
  });

  it("throws on database failure", async () => {
    mockPrisma.emailTemplateOverride.delete.mockRejectedValue(new Error("Record not found"));

    await expect(deleteOverride("disable", "subject", "en")).rejects.toThrow("Record not found");
  });
});

// ─── Tests: bulkUpsertOverrides ────────────────────────────────────────────────

describe("bulkUpsertOverrides", () => {
  it("creates a transaction with upsert operations for each entry", async () => {
    mockPrisma.$transaction.mockResolvedValue([]);

    const entries = [
      { key: "subject", value: "Translated subject" },
      { key: "greeting", value: "Translated greeting" },
    ];

    await bulkUpsertOverrides("disable", "nl", entries);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.emailTemplateOverride.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.emailTemplateOverride.upsert).toHaveBeenCalledWith({
      where: {
        emailType_key_locale: { emailType: "disable", key: "subject", locale: "nl" },
      },
      update: { value: "Translated subject" },
      create: { emailType: "disable", key: "subject", locale: "nl", value: "Translated subject" },
    });
  });

  it("throws on transaction failure", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("Transaction failed"));

    const entries = [{ key: "subject", value: "value" }];

    await expect(bulkUpsertOverrides("disable", "nl", entries)).rejects.toThrow("Transaction failed");
  });
});

// ─── Tests: getDefaultValues ───────────────────────────────────────────────────

describe("getDefaultValues", () => {
  it("returns default values for a valid email type", () => {
    const result = getDefaultValues("disable");

    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("headerTagline");
    expect(result).toHaveProperty("headerTitle");
    expect(result).toHaveProperty("greeting");
    expect(result).toHaveProperty("intro");
  });

  it("returns an empty object for an unknown email type", () => {
    const result = getDefaultValues("nonexistent");

    expect(result).toEqual({});
  });

  it("only includes keys defined in the EMAIL_TYPE_KEYS mapping", () => {
    const result = getDefaultValues("verified");

    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("headerTagline");
    // Should not include keys from other email types
    expect(result).not.toHaveProperty("intro");
    expect(result).not.toHaveProperty("disputePrompt");
  });
});
