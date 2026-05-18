import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupFetchMock, createJsonResponse, createErrorResponse, createNetworkError } from "../helpers/mock-fetch";

// ─── Setup Mocks ───────────────────────────────────────────────────────────────

const fetchMock = setupFetchMock();

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/review-disable/kiyoh-auth-client", () => ({
  authenticateKiyohAdmin: vi.fn(),
}));

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_REVIEW_ID = "review-uuid-abc-123";
const SAMPLE_TENANT_ID = 98;
const SAMPLE_BEARER_TOKEN = "test-bearer-token-value";

const REVIEW_RESPONSE_WITH_EMAIL = {
  reviews: [
    {
      email: "reviewer@example.com",
      reviewId: SAMPLE_REVIEW_ID,
      rating: 8,
    },
  ],
};

const REVIEW_RESPONSE_EMPTY = {
  reviews: [],
};

const REVIEW_RESPONSE_MISSING_EMAIL = {
  reviews: [
    {
      reviewId: SAMPLE_REVIEW_ID,
      rating: 5,
    },
  ],
};

const REVIEW_RESPONSE_BLANK_EMAIL = {
  reviews: [
    {
      email: "   ",
      reviewId: SAMPLE_REVIEW_ID,
    },
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function getAuthMock() {
  const authModule = await import("@/lib/review-disable/kiyoh-auth-client");
  return authModule.authenticateKiyohAdmin as ReturnType<typeof vi.fn>;
}

function mockSuccessfulAuth(authMock: ReturnType<typeof vi.fn>) {
  authMock.mockResolvedValue({ bearerToken: SAMPLE_BEARER_TOKEN });
}

// ─── Tests: Successful Email Resolution ───────────────────────────────────────

describe("resolveReviewerEmail - success path", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.KIYOH_REVIEW_LIST_URL = "https://www.klantenvertellen.nl/v1/review";
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
  });

  it("resolves reviewer email from Kiyoh API response", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createJsonResponse(REVIEW_RESPONSE_WITH_EMAIL));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(true);
    expect(result.email).toBe("reviewer@example.com");
  });

  it("calls the correct URL with reviewId and tenantId parameters", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createJsonResponse(REVIEW_RESPONSE_WITH_EMAIL));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    const fetchCall = fetchMock.mock.calls[0];
    const requestUrl = fetchCall[0] as string;
    expect(requestUrl).toContain("reviewId=review-uuid-abc-123");
    expect(requestUrl).toContain("tenantId=98");
    expect(requestUrl).toContain("limit=1");
  });

  it("includes the bearer token in the Authorization header", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createJsonResponse(REVIEW_RESPONSE_WITH_EMAIL));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    const fetchCall = fetchMock.mock.calls[0];
    const requestOptions = fetchCall[1] as RequestInit;
    expect(requestOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${SAMPLE_BEARER_TOKEN}`,
      })
    );
  });
});

// ─── Tests: Empty API Response ────────────────────────────────────────────────

describe("resolveReviewerEmail - empty response", () => {
  beforeEach(async () => {
    process.env.KIYOH_REVIEW_LIST_URL = "https://www.klantenvertellen.nl/v1/review";
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
  });

  it("returns failure when API returns empty reviews array", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createJsonResponse(REVIEW_RESPONSE_EMPTY));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No reviews found");
  });

  it("returns failure when API returns no reviews field", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createJsonResponse({}));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No reviews found");
  });
});

// ─── Tests: Network Error Handling ────────────────────────────────────────────

describe("resolveReviewerEmail - network errors", () => {
  beforeEach(async () => {
    process.env.KIYOH_REVIEW_LIST_URL = "https://www.klantenvertellen.nl/v1/review";
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
  });

  it("returns failure on network error without throwing", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockRejectedValueOnce(createNetworkError("ECONNREFUSED"));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns failure on non-OK HTTP status", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createErrorResponse(500, "Internal Server Error"));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });

  it("returns failure when authentication fails", async () => {
    const authMock = await getAuthMock();
    authMock.mockRejectedValueOnce(new Error("Auth token expired"));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication failed");
    expect(result.error).toContain("Auth token expired");
  });
});

// ─── Tests: Missing Email Field ───────────────────────────────────────────────

describe("resolveReviewerEmail - missing email field", () => {
  beforeEach(async () => {
    process.env.KIYOH_REVIEW_LIST_URL = "https://www.klantenvertellen.nl/v1/review";
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
  });

  it("returns failure when review has no email field", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createJsonResponse(REVIEW_RESPONSE_MISSING_EMAIL));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("email field is empty");
  });

  it("returns failure when email field is blank whitespace", async () => {
    const authMock = await getAuthMock();
    mockSuccessfulAuth(authMock);
    fetchMock.mockResolvedValueOnce(createJsonResponse(REVIEW_RESPONSE_BLANK_EMAIL));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");
    const result = await resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("email field is empty");
  });

  it("never throws an exception regardless of error type", async () => {
    const authMock = await getAuthMock();
    authMock.mockRejectedValueOnce(new Error("Unexpected failure"));

    const { resolveReviewerEmail } = await import("@/lib/review-disable/kiyoh-review-client");

    await expect(
      resolveReviewerEmail(SAMPLE_REVIEW_ID, SAMPLE_TENANT_ID)
    ).resolves.toBeDefined();
  });
});
