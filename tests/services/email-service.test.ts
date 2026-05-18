import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Setup Mocks ───────────────────────────────────────────────────────────────

const mockSendMail = vi.fn();

vi.mock("nodemailer", () => ({
  createTransport: vi.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

function setSmtpEnvVars() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "user@example.com";
  process.env.SMTP_PASS = "secret-password";
  process.env.SMTP_FROM = "noreply@reviewreceipts.com";
  process.env.APP_URL = "https://app.reviewreceipts.com";
  process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
}

function clearSmtpEnvVars() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  delete process.env.APP_URL;
  delete process.env.DISPUTE_TOKEN_SECRET;
}

const VALID_PARAMS = {
  recipientEmail: "reviewer@example.com",
  locale: "en",
  reviewId: "review-123",
  locationId: "location-456",
  tenantId: 99,
  failureReason: "NOT_A_RECEIPT",
};

// ─── Tests: SMTP Config Validation ────────────────────────────────────────────

describe("sendReviewDisableEmail - SMTP config validation", () => {
  beforeEach(() => {
    vi.resetModules();
    clearSmtpEnvVars();
    mockSendMail.mockReset();
  });

  it("returns failure when SMTP_HOST is missing", async () => {
    setSmtpEnvVars();
    delete process.env.SMTP_HOST;

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP_HOST");
  });

  it("returns failure when SMTP_PORT is missing", async () => {
    setSmtpEnvVars();
    delete process.env.SMTP_PORT;

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP_PORT");
  });

  it("returns failure when SMTP_USER is missing", async () => {
    setSmtpEnvVars();
    delete process.env.SMTP_USER;

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP_USER");
  });

  it("returns failure when SMTP_PASS is missing", async () => {
    setSmtpEnvVars();
    delete process.env.SMTP_PASS;

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP_PASS");
  });

  it("returns failure when SMTP_FROM is missing", async () => {
    setSmtpEnvVars();
    delete process.env.SMTP_FROM;

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP_FROM");
  });

  it("returns failure listing all missing vars when multiple are absent", async () => {
    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP_HOST");
    expect(result.error).toContain("SMTP_PORT");
    expect(result.error).toContain("SMTP_USER");
    expect(result.error).toContain("SMTP_PASS");
    expect(result.error).toContain("SMTP_FROM");
  });
});

// ─── Tests: Translation Loading and Fallback ──────────────────────────────────

describe("loadDisableEmailTranslations", () => {
  it("loads translations for a valid locale", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = loadDisableEmailTranslations("en", "NOT_A_RECEIPT");

    expect(translations.subject).toBe("Your review has been disabled");
    expect(translations.greeting).toBe("Hello,");
    expect(translations.failureReasonText).toBe("The uploaded image was not a valid receipt");
    expect(translations.disputeButtonText).toBe("Dispute this decision");
  });

  it("falls back to en for an unsupported locale", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = loadDisableEmailTranslations("xx", "NOT_A_RECEIPT");

    expect(translations.subject).toBe("Your review has been disabled");
    expect(translations.greeting).toBe("Hello,");
  });

  it("falls back to en for an empty locale string", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = loadDisableEmailTranslations("", "NOT_A_RECEIPT");

    expect(translations.subject).toBe("Your review has been disabled");
  });

  it("maps known failure reason codes to translated text", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = loadDisableEmailTranslations("en", "ADMIN_DISABLED");

    expect(translations.failureReasonText).toBe("An administrator has disabled this review");
  });

  it("uses VERIFICATION_FAILED fallback for unknown failure reason codes", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = loadDisableEmailTranslations("en", "UNKNOWN_REASON_CODE");

    expect(translations.failureReasonText).toBe("The receipt did not pass verification");
  });
});

// ─── Tests: HTML Template Rendering ───────────────────────────────────────────

describe("renderDisableEmailHtml", () => {
  it("interpolates reviewId and locationId into the body", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      failureReason: "The uploaded image was not a valid receipt",
      disputeUrl: "https://app.reviewreceipts.com/dispute?reviewId=rev-abc-123",
      translations: {
        subject: "Your review has been disabled",
        greeting: "Hello,",
        body: "Your review (ID: {reviewId}) for location {locationId} has been disabled because it did not pass our verification process.",
        reasonLabel: "Reason",
        disputeButtonText: "Dispute this decision",
        footer: "If you believe this was a mistake, click the button above to submit a dispute.",
      },
    });

    expect(html).toContain("rev-abc-123");
    expect(html).toContain("loc-789");
    expect(html).not.toContain("{reviewId}");
    expect(html).not.toContain("{locationId}");
  });

  it("includes the dispute link in the rendered HTML", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const disputeUrl = "https://app.reviewreceipts.com/dispute?reviewId=rev-abc-123";
    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      failureReason: "The uploaded image was not a valid receipt",
      disputeUrl: disputeUrl,
      translations: {
        subject: "Your review has been disabled",
        greeting: "Hello,",
        body: "Your review (ID: {reviewId}) for location {locationId} has been disabled.",
        reasonLabel: "Reason",
        disputeButtonText: "Dispute this decision",
        footer: "Footer text.",
      },
    });

    expect(html).toContain(disputeUrl);
    expect(html).toContain("Dispute this decision");
  });

  it("includes the failure reason in the rendered HTML", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      failureReason: "The receipt was flagged for suspected fraud",
      disputeUrl: "https://app.reviewreceipts.com/dispute?reviewId=rev-abc-123",
      translations: {
        subject: "Subject",
        greeting: "Hello,",
        body: "Body text with {reviewId} and {locationId}.",
        reasonLabel: "Reason",
        disputeButtonText: "Dispute",
        footer: "Footer.",
      },
    });

    expect(html).toContain("The receipt was flagged for suspected fraud");
    expect(html).toContain("Reason");
  });
});

describe("renderDisableEmailSubject", () => {
  it("returns the subject from translations", async () => {
    const { renderDisableEmailSubject } = await import("@/lib/email/email-templates");

    const subject = renderDisableEmailSubject({
      reviewId: "rev-123",
      locationId: "loc-456",
      failureReason: "reason",
      disputeUrl: "https://example.com",
      translations: {
        subject: "Your review has been disabled",
        greeting: "Hello,",
        body: "Body",
        reasonLabel: "Reason",
        disputeButtonText: "Dispute",
        footer: "Footer",
      },
    });

    expect(subject).toBe("Your review has been disabled");
  });
});

// ─── Tests: sendReviewDisableEmail Success and Error Paths ────────────────────

describe("sendReviewDisableEmail - transport behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    clearSmtpEnvVars();
    setSmtpEnvVars();
    mockSendMail.mockReset();
  });

  it("sends email successfully and returns success result", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "msg-001" });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "reviewer@example.com",
        from: "noreply@reviewreceipts.com",
      })
    );
  });

  it("returns failure result when transport throws an error", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  it("never throws an exception even on transport failure", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("SMTP timeout"));

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");

    await expect(sendReviewDisableEmail(VALID_PARAMS)).resolves.toBeDefined();
  });
});
