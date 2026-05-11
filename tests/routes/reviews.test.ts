import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  setupPrismaMock,
  setupFetchMock,
  createJsonResponse,
  createErrorResponse,
  createUserSession,
  createAdminSession,
  createTextResponse,
} from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

setupPrismaMock();

const fetchMock = setupFetchMock();

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// Reset env vars before each test to ensure clean state
beforeEach(() => {
  vi.stubEnv("KIYOH_API_TOKEN", "fake-kiyoh-token");
  vi.stubEnv("KV_API_TOKEN", "fake-kv-token");
});

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { GET as getLocations } from "@/app/api/reviews/locations/route";
import { GET as getLocationReviews } from "@/app/api/reviews/location/[locationId]/route";
import { POST as postModerate } from "@/app/api/reviews/moderate/route";
import { GET as getModeration } from "@/app/api/reviews/moderation/route";
import { GET as getNotifications } from "@/app/api/admin/reviews/notifications/route";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_KIYOH_LOCATION = {
  locationId: "loc-100",
  locationName: "Amsterdam Store",
  numberReviews: 42,
  numberReviewsPending: 3,
};

const SAMPLE_KV_LOCATION = {
  locationId: "loc-200",
  locationName: "Rotterdam Store",
  numberReviews: 18,
  numberReviewsPending: 0,
};

const SAMPLE_REVIEW = {
  reviewId: "review-001",
  reviewAuthor: "Jan de Vries",
  rating: 8,
  status: "PUBLISHED",
  reviewContent: [
    { questionGroup: "DEFAULT_OPINION", review: "Great service!" },
  ],
};

const SAMPLE_PENDING_REVIEW = {
  reviewId: "review-002",
  reviewAuthor: "Piet Jansen",
  rating: 4,
  status: "PENDING",
  reviewContent: [
    { questionGroup: "DEFAULT_OPINION", review: "Not happy with the product." },
  ],
};

// ─── Helper Functions ──────────────────────────────────────────────────────────

function createRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Tests: GET /api/reviews/locations ─────────────────────────────────────────

describe("GET /api/reviews/locations", () => {
  let timeOffset = 0;

  beforeEach(() => {
    mockGetServerSession.mockReset();
    // Advance time by 31 minutes to invalidate the module-level cache between tests
    timeOffset += 31 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + timeOffset);
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await getLocations();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const response = await getLocations();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns locations from both Kiyoh and KV platforms", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock
      .mockResolvedValueOnce(createJsonResponse([SAMPLE_KIYOH_LOCATION]))
      .mockResolvedValueOnce(createJsonResponse([SAMPLE_KV_LOCATION]));

    const response = await getLocations();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kiyoh).toHaveLength(1);
    expect(body.kiyoh[0].locationId).toBe("loc-100");
    expect(body.kiyoh[0].source).toBe("kiyoh");
    expect(body.kv).toHaveLength(1);
    expect(body.kv[0].locationId).toBe("loc-200");
    expect(body.kv[0].source).toBe("kv");
    expect(body.errors.kiyoh).toBeNull();
    expect(body.errors.kv).toBeNull();
  });

  it("handles API errors gracefully and reports them", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock
      .mockRejectedValueOnce(new Error("kiyoh API error: 503"))
      .mockResolvedValueOnce(createJsonResponse([SAMPLE_KV_LOCATION]));

    const response = await getLocations();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kiyoh).toEqual([]);
    expect(body.kv).toHaveLength(1);
    expect(body.errors.kiyoh).toContain("kiyoh API error: 503");
    expect(body.errors.kv).toBeNull();
  });

  it("returns empty arrays when no tokens are configured", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    vi.stubEnv("KIYOH_API_TOKEN", "");
    vi.stubEnv("KV_API_TOKEN", "");

    const response = await getLocations();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.kiyoh).toEqual([]);
    expect(body.kv).toEqual([]);
  });
});

// ─── Tests: GET /api/reviews/location/[locationId] ─────────────────────────────

describe("GET /api/reviews/location/[locationId]", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/reviews/location/loc-100?source=kiyoh");
    const response = await getLocationReviews(request, { params: { locationId: "loc-100" } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createRequest("/api/reviews/location/loc-100?source=kiyoh");
    const response = await getLocationReviews(request, { params: { locationId: "loc-100" } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns reviews for a Kiyoh location", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ reviews: [SAMPLE_REVIEW], numberReviews: 1 })
    );

    const request = createRequest("/api/reviews/location/loc-100?source=kiyoh");
    const response = await getLocationReviews(request, { params: { locationId: "loc-100" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].reviewId).toBe("review-001");
    expect(body.total).toBe(1);
  });

  it("returns reviews for a KV location", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ reviews: [SAMPLE_REVIEW], numberReviews: 1 })
    );

    const request = createRequest("/api/reviews/location/loc-200?source=kv");
    const response = await getLocationReviews(request, { params: { locationId: "loc-200" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reviews).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("passes query parameters to the external API", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(createJsonResponse({ reviews: [], numberReviews: 0 }));

    const request = createRequest(
      "/api/reviews/location/loc-100?source=kiyoh&orderBy=RATING&sortOrder=ASC&limit=10"
    );
    await getLocationReviews(request, { params: { locationId: "loc-100" } });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("locationId=loc-100");
    expect(calledUrl).toContain("tenantId=98");
    expect(calledUrl).toContain("orderBy=RATING");
    expect(calledUrl).toContain("sortOrder=ASC");
    expect(calledUrl).toContain("limit=10");
  });

  it("returns 500 when API token is not configured", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    vi.stubEnv("KIYOH_API_TOKEN", "");

    const request = createRequest("/api/reviews/location/loc-100?source=kiyoh");
    const response = await getLocationReviews(request, { params: { locationId: "loc-100" } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("API token not configured");

    vi.stubEnv("KIYOH_API_TOKEN", "fake-kiyoh-token");
  });

  it("handles external API errors gracefully", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(createErrorResponse(500));

    const request = createRequest("/api/reviews/location/loc-100?source=kiyoh");
    const response = await getLocationReviews(request, { params: { locationId: "loc-100" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reviews).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.error).toContain("API 500");
  });
});

// ─── Tests: POST /api/reviews/moderate ─────────────────────────────────────────

describe("POST /api/reviews/moderate", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "abuse",
      locationId: "loc-100",
      reviewId: "review-001",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "abuse",
      locationId: "loc-100",
      reviewId: "review-001",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when required fields are missing", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "abuse",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Missing required fields");
  });

  it("returns 400 for unknown action", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "unknown_action",
      locationId: "loc-100",
      reviewId: "review-001",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unknown action");
  });

  it("successfully reports abuse for a review", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(createTextResponse("", 200));

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "abuse",
      locationId: "loc-100",
      reviewId: "review-001",
      reasonAbuse: "FAKE_REVIEW",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action).toBe("abuse");

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/review/abuse");

    const calledOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(calledOptions.method).toBe("PUT");

    const sentPayload = JSON.parse(calledOptions.body as string);
    expect(sentPayload.locationId).toBe("loc-100");
    expect(sentPayload.reviewId).toBe("review-001");
    expect(sentPayload.abuseReason).toBe("FAKE_REVIEW");
    expect(sentPayload.tenantId).toBe("98");
  });

  it("successfully sends a change request for a review", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(createTextResponse("", 200));

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kv",
      action: "changerequest",
      locationId: "loc-200",
      reviewId: "review-002",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action).toBe("changerequest");

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("klantenvertellen.nl");
    expect(calledUrl).toContain("/review/changerequest");

    const calledOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(calledOptions.method).toBe("PUT");

    const sentPayload = JSON.parse(calledOptions.body as string);
    expect(sentPayload.tenantId).toBe("99");
  });

  it("successfully posts a response to a review", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(createTextResponse("", 200));

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "respond",
      locationId: "loc-100",
      reviewId: "review-001",
      response: "Thank you for your feedback!",
      respondentEmail: "admin@example.com",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.action).toBe("respond");

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/review/external/response");

    const calledOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(calledOptions.method).toBe("POST");

    const sentPayload = JSON.parse(calledOptions.body as string);
    expect(sentPayload.response).toBe("Thank you for your feedback!");
    expect(sentPayload.respondentEmail).toBe("admin@example.com");
  });

  it("returns API error status when external API fails", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockResolvedValueOnce(
      createTextResponse(JSON.stringify({ message: "Review not found" }), 404)
    );

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "abuse",
      locationId: "loc-100",
      reviewId: "nonexistent",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Review not found");
  });

  it("returns 500 when API token is not configured", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    vi.stubEnv("KIYOH_API_TOKEN", "");

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "abuse",
      locationId: "loc-100",
      reviewId: "review-001",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("API token not configured");

    vi.stubEnv("KIYOH_API_TOKEN", "fake-kiyoh-token");
  });

  it("returns 500 when fetch throws a network error", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockRejectedValueOnce(new Error("Network error"));

    const request = createPostRequest("/api/reviews/moderate", {
      source: "kiyoh",
      action: "abuse",
      locationId: "loc-100",
      reviewId: "review-001",
    });
    const response = await postModerate(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Moderation request failed");
  });
});

// ─── Tests: GET /api/reviews/moderation ────────────────────────────────────────

describe("GET /api/reviews/moderation", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/reviews/moderation");
    const response = await getModeration(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createRequest("/api/reviews/moderation");
    const response = await getModeration(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 500 when no API tokens are configured", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    vi.stubEnv("KIYOH_API_TOKEN", "");
    vi.stubEnv("KV_API_TOKEN", "");

    const request = createRequest("/api/reviews/moderation?force=1");
    const response = await getModeration(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("No API tokens configured");

    vi.stubEnv("KIYOH_API_TOKEN", "fake-kiyoh-token");
    vi.stubEnv("KV_API_TOKEN", "fake-kv-token");
  });

  it("returns pending reviews aggregated across locations", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    // First two calls: fetch locations from Kiyoh and KV
    fetchMock
      .mockResolvedValueOnce(createJsonResponse([SAMPLE_KIYOH_LOCATION]))
      .mockResolvedValueOnce(createJsonResponse([SAMPLE_KV_LOCATION]));

    // Third call: fetch reviews for the location with pending reviews (SAMPLE_KIYOH_LOCATION has 3 pending)
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ reviews: [SAMPLE_PENDING_REVIEW] })
    );

    const request = createRequest("/api/reviews/moderation?force=1");
    const response = await getModeration(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].locationId).toBe("loc-100");
    expect(body.reviews[0].source).toBe("kiyoh");
    expect(body.total).toBe(1);
    expect(body.locationCount).toBe(2);
    expect(body.locationsChecked).toBe(1);
  });

  it("checks all locations when all=1 parameter is set", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    // Locations fetch
    fetchMock
      .mockResolvedValueOnce(createJsonResponse([SAMPLE_KIYOH_LOCATION]))
      .mockResolvedValueOnce(createJsonResponse([SAMPLE_KV_LOCATION]));

    // Reviews fetch for both locations (all=1 means check all)
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ reviews: [SAMPLE_PENDING_REVIEW] }))
      .mockResolvedValueOnce(createJsonResponse({ reviews: [] }));

    const request = createRequest("/api/reviews/moderation?force=1&all=1");
    const response = await getModeration(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.locationsChecked).toBe(2);
    expect(body.loadedAll).toBe(true);
  });

  it("handles location fetch failures gracefully", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    // Both location fetches fail
    fetchMock
      .mockResolvedValueOnce(createErrorResponse(500))
      .mockResolvedValueOnce(createErrorResponse(500));

    const request = createRequest("/api/reviews/moderation?force=1");
    const response = await getModeration(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reviews).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.locationCount).toBe(0);
  });
});

// ─── Tests: GET /api/admin/reviews/notifications ───────────────────────────────

describe("GET /api/admin/reviews/notifications", () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest("/api/admin/reviews/notifications");
    const response = await getNotifications(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when user is not an admin", async () => {
    const session = createUserSession();
    mockGetServerSession.mockResolvedValue(session);

    const request = createRequest("/api/admin/reviews/notifications");
    const response = await getNotifications(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns count of 0 when no tokens are configured", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    vi.stubEnv("KIYOH_API_TOKEN", "");
    vi.stubEnv("KV_API_TOKEN", "");

    const request = createRequest("/api/admin/reviews/notifications");
    const response = await getNotifications(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(0);

    vi.stubEnv("KIYOH_API_TOKEN", "fake-kiyoh-token");
    vi.stubEnv("KV_API_TOKEN", "fake-kv-token");
  });

  it("returns notification count from updated locations", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse([
          { locationId: "loc-100", locationName: "Amsterdam" },
          { locationId: "loc-101", locationName: "Utrecht" },
        ])
      )
      .mockResolvedValueOnce(
        createJsonResponse([{ locationId: "loc-200", locationName: "Rotterdam" }])
      );

    const request = createRequest("/api/admin/reviews/notifications");
    const response = await getNotifications(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(3);
    expect(body.updatedLocations).toHaveLength(3);
  });

  it("deduplicates locations across platforms by locationId", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    // Same locationId returned from both platforms
    fetchMock
      .mockResolvedValueOnce(createJsonResponse([{ locationId: "shared-loc" }]))
      .mockResolvedValueOnce(createJsonResponse([{ locationId: "shared-loc" }]));

    const request = createRequest("/api/admin/reviews/notifications");
    const response = await getNotifications(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
  });

  it("returns count 0 when fetch throws an error", async () => {
    const session = createAdminSession();
    mockGetServerSession.mockResolvedValue(session);

    fetchMock.mockRejectedValueOnce(new Error("Network failure"));
    fetchMock.mockRejectedValueOnce(new Error("Network failure"));

    const request = createRequest("/api/admin/reviews/notifications");
    const response = await getNotifications(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(0);
  });
});
