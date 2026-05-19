import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchLocations,
  fetchReviewsForLocation,
  moderateReview,
  fetchPendingReviews,
  fetchNotificationCount,
} from "@/lib/services/review-platform-service";
import type { ReviewPlatformTokens } from "@/lib/services/review-platform-service";

// ─── Helpers ───────────────────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

function mockFetchResponse(body: unknown, options?: { ok?: boolean; status?: number }): void {
  const ok = options?.ok !== undefined ? options.ok : true;
  const status = options?.status || (ok ? 200 : 500);

  const mockResponse = {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;

  globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);
}

function mockFetchSequence(responses: Array<{ body: unknown; ok?: boolean; status?: number }>): void {
  const mockFunction = vi.fn();

  for (let index = 0; index < responses.length; index++) {
    const entry = responses[index];
    const ok = entry.ok !== undefined ? entry.ok : true;
    const status = entry.status || (ok ? 200 : 500);

    mockFunction.mockResolvedValueOnce({
      ok,
      status,
      json: () => Promise.resolve(entry.body),
      text: () => Promise.resolve(JSON.stringify(entry.body)),
    } as unknown as Response);
  }

  globalThis.fetch = mockFunction;
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const KIYOH_TOKEN = "kiyoh-test-token";
const KV_TOKEN = "kv-test-token";

const SAMPLE_LOCATION = {
  locationId: "loc-001",
  locationName: "Test Store Amsterdam",
  numberReviewsPending: 3,
};

const SAMPLE_REVIEW = {
  reviewId: "rev-001",
  status: "PENDING",
  review: "Great service!",
  rating: 9,
};

const SAMPLE_PUBLISHED_REVIEW = {
  reviewId: "rev-002",
  status: "PUBLISHED",
  review: "Good product",
  rating: 8,
};

// ─── Tests: fetchLocations ─────────────────────────────────────────────────────

describe("fetchLocations", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns locations with source on success", async () => {
    mockFetchResponse([SAMPLE_LOCATION]);

    const result = await fetchLocations("kiyoh", KIYOH_TOKEN);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0].source).toBe("kiyoh");
      expect(result.locations[0].locationId).toBe("loc-001");
      expect(result.locations[0].locationName).toBe("Test Store Amsterdam");
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("kiyoh.com/v1/publication/review/locations/latest"),
      expect.objectContaining({
        headers: { "X-Publication-Api-Token": KIYOH_TOKEN },
      })
    );
  });

  it("returns failure on API error", async () => {
    mockFetchResponse(null, { ok: false, status: 401 });

    const result = await fetchLocations("kv", KV_TOKEN);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("kv");
      expect(result.error).toContain("401");
    }
  });
});

// ─── Tests: fetchReviewsForLocation ────────────────────────────────────────────

describe("fetchReviewsForLocation", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns reviews with total on success", async () => {
    const responseBody = {
      reviews: [SAMPLE_REVIEW, SAMPLE_PUBLISHED_REVIEW],
      numberReviews: 42,
    };
    mockFetchResponse(responseBody);

    const result = await fetchReviewsForLocation("kiyoh", "loc-001", KIYOH_TOKEN);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reviews).toHaveLength(2);
      expect(result.total).toBe(42);
    }
  });

  it("returns failure on API error", async () => {
    mockFetchResponse(null, { ok: false, status: 403 });

    const result = await fetchReviewsForLocation("kv", "loc-001", KV_TOKEN);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("403");
    }
  });
});

// ─── Tests: moderateReview ─────────────────────────────────────────────────────

describe("moderateReview", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const MODERATION_PAYLOAD = {
    locationId: "loc-001",
    reviewId: "rev-001",
    reasonAbuse: "FAKE_REVIEW",
    response: "Thank you for your feedback",
    respondentEmail: "admin@example.com",
  };

  it("reports abuse successfully", async () => {
    mockFetchResponse({});

    const result = await moderateReview("kiyoh", "abuse", KIYOH_TOKEN, MODERATION_PAYLOAD);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.action).toBe("abuse");
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/review/abuse"),
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("sends change request successfully", async () => {
    mockFetchResponse({});

    const result = await moderateReview("kv", "changerequest", KV_TOKEN, MODERATION_PAYLOAD);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.action).toBe("changerequest");
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/review/changerequest"),
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("responds to review successfully", async () => {
    mockFetchResponse({});

    const result = await moderateReview("kiyoh", "respond", KIYOH_TOKEN, MODERATION_PAYLOAD);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.action).toBe("respond");
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/review/external/response"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns parsed error message on API failure", async () => {
    const errorBody = { message: "Review not found" };
    mockFetchResponse(errorBody, { ok: false, status: 404 });

    const result = await moderateReview("kiyoh", "abuse", KIYOH_TOKEN, MODERATION_PAYLOAD);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Review not found");
      expect(result.statusCode).toBe(404);
    }
  });
});

// ─── Tests: fetchPendingReviews ────────────────────────────────────────────────

describe("fetchPendingReviews", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns error when no tokens are configured", async () => {
    const tokens: ReviewPlatformTokens = {
      kiyohToken: undefined,
      kvToken: undefined,
    };

    const result = await fetchPendingReviews(tokens);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("No API tokens");
    }
  });

  it("aggregates pending reviews from both platforms", async () => {
    const tokens: ReviewPlatformTokens = {
      kiyohToken: KIYOH_TOKEN,
      kvToken: KV_TOKEN,
    };

    // First two calls: fetchLocations for kiyoh and kv (parallel)
    // Then: fetchPendingForSingleLocation for each location with pending reviews
    mockFetchSequence([
      { body: [{ ...SAMPLE_LOCATION, locationId: "kiyoh-loc" }] },
      { body: [{ ...SAMPLE_LOCATION, locationId: "kv-loc" }] },
      { body: { reviews: [SAMPLE_REVIEW] } },
      { body: { reviews: [SAMPLE_REVIEW] } },
    ]);

    const resultPromise = fetchPendingReviews(tokens);

    // Advance timers to handle rate limit delays
    await vi.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviews.length).toBe(2);
      expect(result.data.locationCount).toBe(2);
    }
  });

  it("filters reviews by pending status", async () => {
    const tokens: ReviewPlatformTokens = {
      kiyohToken: KIYOH_TOKEN,
      kvToken: undefined,
    };

    mockFetchSequence([
      { body: [{ ...SAMPLE_LOCATION, locationId: "loc-1" }] },
      { body: { reviews: [SAMPLE_REVIEW, SAMPLE_PUBLISHED_REVIEW] } },
    ]);

    const resultPromise = fetchPendingReviews(tokens);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    if (result.success) {
      // Only the PENDING review should be included, not the PUBLISHED one
      expect(result.data.reviews.length).toBe(1);
    }
  });
});

// ─── Tests: fetchNotificationCount ─────────────────────────────────────────────

describe("fetchNotificationCount", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns count of updated locations", async () => {
    const tokens: ReviewPlatformTokens = {
      kiyohToken: KIYOH_TOKEN,
      kvToken: KV_TOKEN,
    };

    mockFetchSequence([
      { body: [{ locationId: "loc-1", locationName: "Store A" }] },
      { body: [{ locationId: "loc-2", locationName: "Store B" }] },
    ]);

    const result = await fetchNotificationCount(tokens);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(2);
      expect(result.data.updatedLocations).toHaveLength(2);
    }
  });

  it("returns zero when no tokens are configured", async () => {
    const tokens: ReviewPlatformTokens = {
      kiyohToken: undefined,
      kvToken: undefined,
    };

    const result = await fetchNotificationCount(tokens);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.count).toBe(0);
      expect(result.data.updatedLocations).toHaveLength(0);
    }
  });
});
