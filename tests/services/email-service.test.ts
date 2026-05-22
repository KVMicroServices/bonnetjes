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

const mockGetSmtpSettings = vi.fn();

vi.mock("@/lib/services/app-settings-service", () => ({
  getSmtpSettings: (...args: unknown[]) => mockGetSmtpSettings(...args),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

function setSmtpEnvVars() {
  process.env.APP_URL = "https://app.reviewreceipts.com";
  process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
  mockGetSmtpSettings.mockResolvedValue({
    smtpHost: "smtp.example.com",
    smtpPort: "587",
    smtpUser: "user@example.com",
    smtpPass: "secret-password",
    smtpFrom: "noreply@reviewreceipts.com",
  });
}

function clearSmtpEnvVars() {
  delete process.env.APP_URL;
  delete process.env.DISPUTE_TOKEN_SECRET;
  mockGetSmtpSettings.mockReset();
}

const VALID_PARAMS = {
  recipientEmail: "reviewer@example.com",
  locale: "en",
  reviewId: "review-123",
  locationId: "location-456",
  tenantId: 99,
  failureReason: "NOT_A_RECEIPT",
};

const SAMPLE_TRANSLATIONS = {
  subject: "Update on your review — proof of purchase rejected",
  headerTagline: "Update on your review",
  headerTitle: "Proof of Purchase Rejected",
  greeting: "Dear reviewer,",
  intro: "We are writing to let you know that your review has been removed. {guidelinesLink}",
  guidelinesLinkText: "user guidelines",
  requirementsIntro: "A valid proof of purchase must include:",
  requirementCompanyName: "Company name.",
  requirementDate: "Date.",
  requirementOrderNumber: "Order number.",
  requirementCustomerName: "Your name.",
  disputePrompt: "Tap below to dispute.",
  disputeButtonText: "Dispute & Re-upload",
  signOff: "Kind regards,",
  teamName: "The Review Team",
  termsButtonText: "View Terms of Use",
  privacyButtonText: "Privacy Policy",
  questionsLabel: "Questions?",
  reasonLabel: "Reason",
  failureReasonText: "The uploaded image was not a valid receipt",
};

const SAMPLE_BRAND = {
  brandName: "Klantenvertellen",
  logoUrl: "https://mcusercontent.com/841b96d7208ddd848e8215ade/images/6aa90dcf-7d1b-4904-886c-cd9ee64d3b67.png",
  bannerImageUrl: "https://kiyoh.com/wp-content/uploads/AdobeStock_262582377-scaled-e1599809135705.jpg",
  termsUrl: "https://www.klantenvertellen.nl/en/terms-of-use-customer-review-system/",
  privacyPolicyUrl: "https://kiyoh.com/privacy/",
  supportEmail: "marketing@kiyoh.co.za",
};

// ─── Tests: SMTP Config Validation ────────────────────────────────────────────

describe("sendReviewDisableEmail - SMTP config validation", () => {
  beforeEach(() => {
    vi.resetModules();
    clearSmtpEnvVars();
    mockSendMail.mockReset();
  });

  it("returns failure when SMTP_HOST is missing", async () => {
    process.env.APP_URL = "https://app.reviewreceipts.com";
    process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
    mockGetSmtpSettings.mockResolvedValue({
      smtpHost: null,
      smtpPort: "587",
      smtpUser: "user@example.com",
      smtpPass: "secret-password",
      smtpFrom: "noreply@reviewreceipts.com",
    });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns failure when SMTP_PORT is missing", async () => {
    process.env.APP_URL = "https://app.reviewreceipts.com";
    process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
    mockGetSmtpSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpPort: null,
      smtpUser: "user@example.com",
      smtpPass: "secret-password",
      smtpFrom: "noreply@reviewreceipts.com",
    });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns failure when SMTP_USER is missing", async () => {
    process.env.APP_URL = "https://app.reviewreceipts.com";
    process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
    mockGetSmtpSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      smtpUser: null,
      smtpPass: "secret-password",
      smtpFrom: "noreply@reviewreceipts.com",
    });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns failure when SMTP_PASS is missing", async () => {
    process.env.APP_URL = "https://app.reviewreceipts.com";
    process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
    mockGetSmtpSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      smtpUser: "user@example.com",
      smtpPass: null,
      smtpFrom: "noreply@reviewreceipts.com",
    });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns failure when SMTP_FROM is missing", async () => {
    process.env.APP_URL = "https://app.reviewreceipts.com";
    process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
    mockGetSmtpSettings.mockResolvedValue({
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      smtpUser: "user@example.com",
      smtpPass: "secret-password",
      smtpFrom: null,
    });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns failure when all SMTP settings are missing", async () => {
    process.env.DISPUTE_TOKEN_SECRET = "test-dispute-token-secret";
    mockGetSmtpSettings.mockResolvedValue({
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPass: null,
      smtpFrom: null,
    });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    const result = await sendReviewDisableEmail(VALID_PARAMS);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── Tests: Translation Loading and Fallback ──────────────────────────────────

describe("loadDisableEmailTranslations", () => {
  it("loads translations for a valid locale", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = await loadDisableEmailTranslations("en", "NOT_A_RECEIPT");

    expect(translations.subject).toContain("review");
    expect(translations.headerTitle).toBe("Proof of Purchase Rejected");
    expect(translations.greeting).toBe("Dear reviewer,");
    expect(translations.failureReasonText).toBe("The uploaded image was not a valid receipt");
    expect(translations.disputeButtonText).toBe("Dispute & Re-upload");
    expect(translations.requirementCompanyName).toContain("company name");
  });

  it("falls back to en for an unsupported locale", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = await loadDisableEmailTranslations("xx", "NOT_A_RECEIPT");

    expect(translations.headerTitle).toBe("Proof of Purchase Rejected");
    expect(translations.greeting).toBe("Dear reviewer,");
  });

  it("falls back to en for an empty locale string", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = await loadDisableEmailTranslations("", "NOT_A_RECEIPT");

    expect(translations.headerTitle).toBe("Proof of Purchase Rejected");
  });

  it("maps known failure reason codes to translated text", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = await loadDisableEmailTranslations("en", "ADMIN_DISABLED");

    expect(translations.failureReasonText).toBe("An administrator has disabled this review");
  });

  it("uses VERIFICATION_FAILED fallback for unknown failure reason codes", async () => {
    const { loadDisableEmailTranslations } = await import("@/lib/email/email-translations");

    const translations = await loadDisableEmailTranslations("en", "UNKNOWN_REASON_CODE");

    expect(translations.failureReasonText).toBe("The receipt did not pass verification");
  });
});

// ─── Tests: Brand Resolution ──────────────────────────────────────────────────

describe("resolveBrandConfig", () => {
  it("returns Kiyoh branding for tenant 98", async () => {
    const { resolveBrandConfig } = await import("@/lib/email/email-brand");

    const brand = resolveBrandConfig(98);

    expect(brand.brandName).toBe("Kiyoh");
    expect(brand.logoUrl).toContain("mcusercontent.com");
    expect(brand.supportEmail).toBe("marketing@kiyoh.co.za");
    expect(brand.termsUrl).toContain("klantenvertellen.nl/en/terms-of-use-customer-review-system");
    expect(brand.privacyPolicyUrl).toBe("https://kiyoh.com/privacy/");
  });

  it("returns Klantenvertellen branding for tenant 99", async () => {
    const { resolveBrandConfig } = await import("@/lib/email/email-brand");

    const brand = resolveBrandConfig(99);

    expect(brand.brandName).toBe("Klantenvertellen");
    expect(brand.logoUrl).toContain("mcusercontent.com");
    expect(brand.supportEmail).toBe("marketing@kiyoh.co.za");
    expect(brand.termsUrl).toContain("klantenvertellen.nl/en/terms-of-use-customer-review-system");
    expect(brand.privacyPolicyUrl).toBe("https://kiyoh.com/privacy/");
  });
});

// ─── Tests: HTML Template Rendering ───────────────────────────────────────────

describe("renderDisableEmailHtml", () => {
  it("renders the brand logo and brand name in the banner", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: "https://app.reviewreceipts.com/dispute?token=abc",
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(html).toContain(SAMPLE_BRAND.logoUrl);
    expect(html).toContain(SAMPLE_BRAND.brandName);
  });

  it("renders all four requirement bullets", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: "https://app.reviewreceipts.com/dispute?token=abc",
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(html).toContain(SAMPLE_TRANSLATIONS.requirementCompanyName);
    expect(html).toContain(SAMPLE_TRANSLATIONS.requirementDate);
    expect(html).toContain(SAMPLE_TRANSLATIONS.requirementOrderNumber);
    expect(html).toContain(SAMPLE_TRANSLATIONS.requirementCustomerName);
  });

  it("includes the dispute link and CTA button text", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const disputeUrl = "https://app.reviewreceipts.com/dispute?token=signed-token";
    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: disputeUrl,
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(html).toContain(disputeUrl);
    expect(html).toContain("Dispute &amp; Re-upload");
  });

  it("interpolates the guidelines link inside the intro paragraph", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: "https://app.reviewreceipts.com/dispute?token=abc",
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(html).toContain(SAMPLE_BRAND.termsUrl);
    expect(html).toContain(SAMPLE_TRANSLATIONS.guidelinesLinkText);
    expect(html).not.toContain("{guidelinesLink}");
  });

  it("includes failure reason and reason label", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: "https://app.reviewreceipts.com/dispute?token=abc",
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(html).toContain(SAMPLE_TRANSLATIONS.failureReasonText);
    expect(html).toContain(SAMPLE_TRANSLATIONS.reasonLabel);
  });

  it("renders the support email as a mailto link in the footer", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: "https://app.reviewreceipts.com/dispute?token=abc",
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(html).toContain(`mailto:${SAMPLE_BRAND.supportEmail}`);
    expect(html).toContain(SAMPLE_TRANSLATIONS.signOff);
    expect(html).toContain(SAMPLE_TRANSLATIONS.teamName);
    expect(html).toContain(SAMPLE_TRANSLATIONS.termsButtonText);
  });

  it("renders the privacy policy link in the footer", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: "https://app.reviewreceipts.com/dispute?token=abc",
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(html).toContain(SAMPLE_BRAND.privacyPolicyUrl);
    expect(html).toContain("Privacy Policy");
  });

  it("escapes HTML special characters in translation values", async () => {
    const { renderDisableEmailHtml } = await import("@/lib/email/email-templates");

    const html = renderDisableEmailHtml({
      reviewId: "rev-abc-123",
      locationId: "loc-789",
      disputeUrl: "https://app.reviewreceipts.com/dispute?token=abc",
      translations: { ...SAMPLE_TRANSLATIONS, headerTitle: "Hi <script>alert('x')</script>" },
      brand: SAMPLE_BRAND,
    });

    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderDisableEmailSubject", () => {
  it("returns the subject from translations", async () => {
    const { renderDisableEmailSubject } = await import("@/lib/email/email-templates");

    const subject = renderDisableEmailSubject({
      reviewId: "rev-123",
      locationId: "loc-456",
      disputeUrl: "https://example.com",
      translations: SAMPLE_TRANSLATIONS,
      brand: SAMPLE_BRAND,
    });

    expect(subject).toBe(SAMPLE_TRANSLATIONS.subject);
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

  it("uses the Klantenvertellen branding when tenantId is 99", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "msg-002" });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    await sendReviewDisableEmail({ ...VALID_PARAMS, tenantId: 99 });

    const sentArgs = mockSendMail.mock.calls[0][0];
    expect(sentArgs.html).toContain("mcusercontent.com");
    expect(sentArgs.html).toContain("marketing@kiyoh.co.za");
  });

  it("uses the Kiyoh branding when tenantId is 98", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "msg-003" });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    await sendReviewDisableEmail({ ...VALID_PARAMS, tenantId: 98 });

    const sentArgs = mockSendMail.mock.calls[0][0];
    expect(sentArgs.html).toContain("mcusercontent.com");
    expect(sentArgs.html).toContain("marketing@kiyoh.co.za");
  });

  it("prepends https:// when APP_URL has no scheme so the dispute link is clickable", async () => {
    process.env.APP_URL = "localhost:3000";
    mockSendMail.mockResolvedValueOnce({ messageId: "msg-004" });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    await sendReviewDisableEmail(VALID_PARAMS);

    const sentArgs = mockSendMail.mock.calls[0][0];
    expect(sentArgs.html).toContain('href="https://localhost:3000/dispute?token=');
  });

  it("preserves http:// when APP_URL already has a scheme", async () => {
    process.env.APP_URL = "http://localhost:3000";
    mockSendMail.mockResolvedValueOnce({ messageId: "msg-005" });

    const { sendReviewDisableEmail } = await import("@/lib/email/email-service");
    await sendReviewDisableEmail(VALID_PARAMS);

    const sentArgs = mockSendMail.mock.calls[0][0];
    expect(sentArgs.html).toContain('href="http://localhost:3000/dispute?token=');
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
