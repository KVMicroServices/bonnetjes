import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupPrismaMock, mockPrisma } from "../helpers/mock-prisma";
import { setupFetchMock, createJsonResponse, createErrorResponse } from "../helpers/mock-fetch";

// ─── Setup Mocks ───────────────────────────────────────────────────────────────

setupPrismaMock();
const fetchMock = setupFetchMock();

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_SYNC_STATE = {
  id: "sync-001",
  reviewId: "review-uuid-123",
  tenantId: 98,
  locationId: "1080211",
  status: "PROCESSED",
  receiptId: "receipt-001",
  s3Key: null,
  s3Etag: null,
  attemptCount: 1,
  processedAt: new Date(),
  errorMessage: null,
  receiptContent: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const LOGIN_RESPONSE = {
  requiresOtp: true,
  otpSessionId: "session-abc-123",
};

const VERIFY_OTP_RESPONSE = {
  hash: "login-hash-value",
};

const CONTEXT_RESPONSE = {
  token: "bearer-token-hash-value",
  refreshToken: "refresh-token-value",
  user: {
    userId: "19529",
    tenantId: 99,
    name: "Test User",
    email: "test@example.com",
    active: true,
    role: "TENANT_ADMIN",
  },
};

// ─── Helper: Mock successful auth flow ─────────────────────────────────────────

function mockSuccessfulAuth() {
  fetchMock
    .mockResolvedValueOnce(createJsonResponse(LOGIN_RESPONSE))
    .mockResolvedValueOnce(createJsonResponse(VERIFY_OTP_RESPONSE))
    .mockResolvedValueOnce(createJsonResponse(CONTEXT_RESPONSE));
}

function mockSuccessfulAuthAndDisable() {
  fetchMock
    .mockResolvedValueOnce(createJsonResponse(LOGIN_RESPONSE))
    .mockResolvedValueOnce(createJsonResponse(VERIFY_OTP_RESPONSE))
    .mockResolvedValueOnce(createJsonResponse(CONTEXT_RESPONSE))
    .mockResolvedValueOnce(createJsonResponse({ success: true }));
}

// ─── Tests: Kiyoh Auth Client ──────────────────────────────────────────────────

describe("authenticateKiyohAdmin", () => {
  beforeEach(async () => {
    process.env.KIYOH_ADMIN_USERNAME = "testuser";
    process.env.KIYOH_ADMIN_PASSWORD = "testpass";
    process.env.KIYOH_ADMIN_TOTP = "JBSWY3DPEHPK3PXP";
    process.env.KIYOH_ADMIN_TENANT = "99";
    process.env.KIYOH_AUTH_BASE_URL = "https://www.klantenvertellen.nl/v1/authentication";
    process.env.KIYOH_CONTEXT_URL = "https://www.klantenvertellen.nl/v1/common/context";
    const { invalidateKiyohTokenCache } = await import("@/lib/review-disable/kiyoh-auth-client");
    invalidateKiyohTokenCache();
  });

  it("performs login, OTP verification, and context exchange to obtain bearer token", async () => {
    const { authenticateKiyohAdmin } = await import("@/lib/review-disable/kiyoh-auth-client");

    fetchMock
      .mockResolvedValueOnce(createJsonResponse(LOGIN_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(VERIFY_OTP_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(CONTEXT_RESPONSE));

    const result = await authenticateKiyohAdmin();

    expect(result.bearerToken).toBe("bearer-token-hash-value");

    // Verify login call
    const loginCall = fetchMock.mock.calls[0];
    expect(loginCall[0]).toBe("https://www.klantenvertellen.nl/v1/authentication/login");
    expect(loginCall[1].method).toBe("POST");
    expect(loginCall[1].body).toContain("tenantId=99");
    expect(loginCall[1].body).toContain("username=testuser");
    expect(loginCall[1].body).toContain("password=testpass");

    // Verify OTP call
    const otpCall = fetchMock.mock.calls[1];
    expect(otpCall[0]).toBe("https://www.klantenvertellen.nl/v1/authentication/verify-otp");
    expect(otpCall[1].method).toBe("POST");
    expect(otpCall[1].body).toContain("otpSessionId=session-abc-123");
    expect(otpCall[1].body).toContain("otpCode=");

    // Verify context exchange call
    const contextCall = fetchMock.mock.calls[2];
    expect(contextCall[0]).toBe("https://www.klantenvertellen.nl/v1/common/context?hash=login-hash-value");
    expect(contextCall[1].method).toBe("GET");
  });

  it("throws when login request fails", async () => {
    const { authenticateKiyohAdmin } = await import("@/lib/review-disable/kiyoh-auth-client");

    fetchMock.mockResolvedValueOnce(createErrorResponse(401, { error: "Invalid credentials" }));

    await expect(authenticateKiyohAdmin()).rejects.toThrow("Kiyoh login failed with status 401");
  });

  it("throws when OTP verification fails", async () => {
    const { authenticateKiyohAdmin } = await import("@/lib/review-disable/kiyoh-auth-client");

    fetchMock
      .mockResolvedValueOnce(createJsonResponse(LOGIN_RESPONSE))
      .mockResolvedValueOnce(createErrorResponse(403, { error: "Invalid OTP" }));

    await expect(authenticateKiyohAdmin()).rejects.toThrow("Kiyoh OTP verification failed with status 403");
  });

  it("throws when environment variables are missing", async () => {
    const { authenticateKiyohAdmin } = await import("@/lib/review-disable/kiyoh-auth-client");

    delete process.env.KIYOH_ADMIN_USERNAME;

    await expect(authenticateKiyohAdmin()).rejects.toThrow("Missing Kiyoh admin credentials");
  });
});

// ─── Tests: Review Disable Service ─────────────────────────────────────────────

describe("disableReviewByReceiptId", () => {
  beforeEach(async () => {
    process.env.KIYOH_ADMIN_USERNAME = "testuser";
    process.env.KIYOH_ADMIN_PASSWORD = "testpass";
    process.env.KIYOH_ADMIN_TOTP = "JBSWY3DPEHPK3PXP";
    process.env.KIYOH_AUTH_BASE_URL = "https://www.klantenvertellen.nl/v1/authentication";
    process.env.KIYOH_CONTEXT_URL = "https://www.klantenvertellen.nl/v1/common/context";
    process.env.KIYOH_REVIEW_API_BASE_URL = "https://www.klantenvertellen.nl/v1/review";
    const { invalidateKiyohTokenCache } = await import("@/lib/review-disable/kiyoh-auth-client");
    invalidateKiyohTokenCache();
  });

  it("disables review when ReceiptSyncState exists", async () => {
    const { disableReviewByReceiptId } = await import("@/lib/review-disable/review-disable-service");

    (mockPrisma.receiptSyncState.findFirst as any).mockResolvedValue(SAMPLE_SYNC_STATE);
    mockSuccessfulAuthAndDisable();

    const result = await disableReviewByReceiptId("receipt-001");

    expect(result.success).toBe(true);
    expect(result.reviewId).toBe("review-uuid-123");

    // Verify the PUT call to KlantenVertellen
    const putCall = fetchMock.mock.calls[3];
    expect(putCall[0]).toBe("https://www.klantenvertellen.nl/v1/review/active");
    expect(putCall[1].method).toBe("PUT");

    const putBody = JSON.parse(putCall[1].body);
    expect(putBody.active).toBe(false);
    expect(putBody.reviewId).toBe("review-uuid-123");
    expect(putBody.locationId).toBe("1080211");
    expect(putBody.tenantId).toBe(98);
  });

  it("returns error when no ReceiptSyncState exists", async () => {
    const { disableReviewByReceiptId } = await import("@/lib/review-disable/review-disable-service");

    (mockPrisma.receiptSyncState.findFirst as any).mockResolvedValue(null);

    const result = await disableReviewByReceiptId("receipt-missing");

    expect(result.success).toBe(false);
    expect(result.error).toContain("No ReceiptSyncState found");
  });

  it("returns error when KlantenVertellen API fails", async () => {
    const { disableReviewByReceiptId } = await import("@/lib/review-disable/review-disable-service");

    (mockPrisma.receiptSyncState.findFirst as any).mockResolvedValue(SAMPLE_SYNC_STATE);
    mockSuccessfulAuth();
    fetchMock.mockResolvedValueOnce(createErrorResponse(500, "Internal Server Error"));

    const result = await disableReviewByReceiptId("receipt-001");

    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });
});

describe("enableReviewByReceiptId", () => {
  beforeEach(async () => {
    process.env.KIYOH_ADMIN_USERNAME = "testuser";
    process.env.KIYOH_ADMIN_PASSWORD = "testpass";
    process.env.KIYOH_ADMIN_TOTP = "JBSWY3DPEHPK3PXP";
    process.env.KIYOH_AUTH_BASE_URL = "https://www.klantenvertellen.nl/v1/authentication";
    process.env.KIYOH_CONTEXT_URL = "https://www.klantenvertellen.nl/v1/common/context";
    process.env.KIYOH_REVIEW_API_BASE_URL = "https://www.klantenvertellen.nl/v1/review";
    const { invalidateKiyohTokenCache } = await import("@/lib/review-disable/kiyoh-auth-client");
    invalidateKiyohTokenCache();
  });

  it("enables review when ReceiptSyncState exists", async () => {
    const { enableReviewByReceiptId } = await import("@/lib/review-disable/review-disable-service");

    (mockPrisma.receiptSyncState.findFirst as any).mockResolvedValue(SAMPLE_SYNC_STATE);
    mockSuccessfulAuthAndDisable();

    const result = await enableReviewByReceiptId("receipt-001");

    expect(result.success).toBe(true);
    expect(result.reviewId).toBe("review-uuid-123");

    // Verify active: true in the PUT body
    const putCall = fetchMock.mock.calls[3];
    const putBody = JSON.parse(putCall[1].body);
    expect(putBody.active).toBe(true);
  });

  it("returns error when no ReceiptSyncState exists", async () => {
    const { enableReviewByReceiptId } = await import("@/lib/review-disable/review-disable-service");

    (mockPrisma.receiptSyncState.findFirst as any).mockResolvedValue(null);

    const result = await enableReviewByReceiptId("receipt-missing");

    expect(result.success).toBe(false);
    expect(result.error).toContain("No ReceiptSyncState found");
  });
});

describe("disableReviewManual", () => {
  beforeEach(async () => {
    process.env.KIYOH_ADMIN_USERNAME = "testuser";
    process.env.KIYOH_ADMIN_PASSWORD = "testpass";
    process.env.KIYOH_ADMIN_TOTP = "JBSWY3DPEHPK3PXP";
    process.env.KIYOH_AUTH_BASE_URL = "https://www.klantenvertellen.nl/v1/authentication";
    process.env.KIYOH_CONTEXT_URL = "https://www.klantenvertellen.nl/v1/common/context";
    process.env.KIYOH_REVIEW_API_BASE_URL = "https://www.klantenvertellen.nl/v1/review";
    const { invalidateKiyohTokenCache } = await import("@/lib/review-disable/kiyoh-auth-client");
    invalidateKiyohTokenCache();
  });

  it("disables review by direct IDs without ReceiptSyncState lookup", async () => {
    const { disableReviewManual } = await import("@/lib/review-disable/review-disable-service");

    mockSuccessfulAuthAndDisable();

    const result = await disableReviewManual("review-uuid-456", "1080211", 98);

    expect(result.success).toBe(true);

    // Should NOT have called prisma
    expect(mockPrisma.receiptSyncState.findFirst).not.toHaveBeenCalled();

    // Verify the PUT call
    const putCall = fetchMock.mock.calls[3];
    const putBody = JSON.parse(putCall[1].body);
    expect(putBody.reviewId).toBe("review-uuid-456");
    expect(putBody.locationId).toBe("1080211");
    expect(putBody.tenantId).toBe(98);
    expect(putBody.active).toBe(false);
  });
});
