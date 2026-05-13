// ─── Constants ───────────────────────────────────────────────────────────────

const KIYOH_BASE_URL = "https://www.kiyoh.com/v1/publication";
const KV_BASE_URL = "https://www.klantenvertellen.nl/v1/publication";

const TENANT_IDS: Readonly<Record<string, string>> = {
  kiyoh: "98",
  kv: "99",
};

const LOCATIONS_SINCE_DATE = "2019-01-01T00:00:00.000+00:00";
const LOCATIONS_LIMIT = "10000";
const REVIEWS_DEFAULT_LIMIT = "25";
const REVIEWS_DEFAULT_ORDER_BY = "CREATE_DATE";
const REVIEWS_DEFAULT_SORT_ORDER = "DESC";
const PENDING_REVIEWS_LIMIT = "100";
const NOTIFICATION_LOOKBACK_HOURS = 24;
const NOTIFICATION_LOCATIONS_LIMIT = "100";
const RATE_LIMIT_DELAY_MILLISECONDS = 1000;

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  "",
  "PENDING",
  "NEW",
  "CONCEPT",
  "DRAFT",
]);

const PUBLISHED_STATUSES: ReadonlySet<string> = new Set([
  "PUBLISHED",
  "VERIFIED",
  "APPROVED",
  "REJECTED",
  "DELETED",
]);

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReviewSource = "kiyoh" | "kv";

export interface ReviewPlatformTokens {
  kiyohToken: string | undefined;
  kvToken: string | undefined;
}

export interface FetchReviewsOptions {
  orderBy?: string;
  sortOrder?: string;
  limit?: string;
}

export interface ModerationPayload {
  locationId: string;
  reviewId: string;
  reasonAbuse?: string;
  response?: string;
  respondentEmail?: string;
}

export type ModerationAction = "abuse" | "changerequest" | "respond";

// ─── Result Types ────────────────────────────────────────────────────────────

export interface LocationEntry {
  locationId: string;
  locationName: string;
  source: ReviewSource;
  numberReviewsPending?: number;
  [key: string]: unknown;
}

export type FetchLocationsResult =
  | { success: true; locations: ReadonlyArray<LocationEntry> }
  | { success: false; error: string };

export interface ReviewEntry {
  [key: string]: unknown;
}

export type FetchReviewsResult =
  | { success: true; reviews: ReadonlyArray<ReviewEntry>; total: number }
  | { success: false; error: string };

export type ModerateReviewResult =
  | { success: true; action: ModerationAction }
  | { success: false; error: string; statusCode: number };

export interface PendingReviewEntry {
  locationId: string;
  locationName: string;
  source: ReviewSource;
  _id: string;
  _content: string;
  [key: string]: unknown;
}

export interface PendingReviewsData {
  reviews: ReadonlyArray<PendingReviewEntry>;
  total: number;
  locationCount: number;
  locationsChecked: number;
  loadedAll: boolean;
}

export type FetchPendingReviewsResult =
  | { success: true; data: PendingReviewsData }
  | { success: false; error: string };

export interface NotificationData {
  count: number;
  updatedLocations: ReadonlyArray<LocationEntry>;
}

export type FetchNotificationCountResult =
  | { success: true; data: NotificationData }
  | { success: false; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBaseUrl(source: ReviewSource): string {
  if (source === "kv") {
    return KV_BASE_URL;
  }
  return KIYOH_BASE_URL;
}

function getTokenForSource(source: ReviewSource, tokens: ReviewPlatformTokens): string | undefined {
  if (source === "kv") {
    return tokens.kvToken;
  }
  return tokens.kiyohToken;
}

function extractReviewId(review: Record<string, unknown>): string {
  const candidates: ReadonlyArray<string> = [
    "reviewId",
    "id",
    "feedbackId",
    "hashCode",
    "externalId",
    "uuid",
  ];

  for (const key of candidates) {
    const value = review[key];
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  return "";
}

function extractReviewContent(review: Record<string, unknown>): string {
  const directFields: ReadonlyArray<string> = [
    "review",
    "content",
    "comment",
    "opinion",
    "text",
  ];

  for (const field of directFields) {
    const value = review[field];
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  const reviewContent = review["reviewContent"];
  if (Array.isArray(reviewContent)) {
    const opinionEntry = reviewContent.find(
      (entry: Record<string, unknown>) =>
        entry.questionGroup === "DEFAULT_OPINION" || entry.questionGroup === "OPINION"
    );
    if (opinionEntry) {
      const text = opinionEntry.review || opinionEntry.content || opinionEntry.text;
      if (text) {
        return String(text);
      }
    }

    const fallbackEntry = reviewContent.find(
      (entry: Record<string, unknown>) => entry.review || entry.content || entry.text
    );
    if (fallbackEntry) {
      const text = fallbackEntry.review || fallbackEntry.content || fallbackEntry.text;
      if (text) {
        return String(text);
      }
    }
  }

  return "";
}

function isPendingStatus(statusValue: string): boolean {
  const normalizedStatus = statusValue.toUpperCase();

  if (PENDING_STATUSES.has(normalizedStatus)) {
    return true;
  }

  if (PUBLISHED_STATUSES.has(normalizedStatus)) {
    return false;
  }

  return true;
}

function extractReviewsFromResponse(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data;
  }

  const dataObject = data as Record<string, unknown>;
  const candidates: ReadonlyArray<string> = ["reviews", "content", "feedbacks", "items"];

  for (const key of candidates) {
    const value = dataObject[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// ─── Service Functions ───────────────────────────────────────────────────────

/** Fetch all locations from a review platform. */
export async function fetchLocations(
  source: ReviewSource,
  token: string
): Promise<FetchLocationsResult> {
  const baseUrl = getBaseUrl(source);
  const encodedSince = encodeURIComponent(LOCATIONS_SINCE_DATE);
  const url = `${baseUrl}/review/locations/latest?updatedSince=${encodedSince}&dateSince=${encodedSince}&limit=${LOCATIONS_LIMIT}`;

  const response = await fetch(url, {
    headers: { "X-Publication-Api-Token": token },
    cache: "no-store",
  });

  if (!response.ok) {
    return { success: false, error: `${source} API error: ${response.status}` };
  }

  const data: unknown = await response.json();
  const rawLocations = Array.isArray(data) ? data : [];

  const locations: Array<LocationEntry> = rawLocations.map((location: Record<string, unknown>) => ({
    ...location,
    locationId: String(location.locationId || location.id || location.hashCode || ""),
    locationName: String(location.locationName || location.name || location.companyName || ""),
    source,
  }));

  return { success: true, locations };
}

/** Fetch reviews for a specific location with ordering options. */
export async function fetchReviewsForLocation(
  source: ReviewSource,
  locationId: string,
  token: string,
  options?: FetchReviewsOptions
): Promise<FetchReviewsResult> {
  const baseUrl = getBaseUrl(source);
  const tenantId = TENANT_IDS[source];
  const orderBy = options?.orderBy || REVIEWS_DEFAULT_ORDER_BY;
  const sortOrder = options?.sortOrder || REVIEWS_DEFAULT_SORT_ORDER;
  const limit = options?.limit || REVIEWS_DEFAULT_LIMIT;

  const url = new URL(`${baseUrl}/review/external`);
  url.searchParams.set("locationId", locationId);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("orderBy", orderBy);
  url.searchParams.set("sortOrder", sortOrder);
  url.searchParams.set("limit", limit);

  const response = await fetch(url.toString(), {
    headers: { "X-Publication-Api-Token": token },
  });

  if (!response.ok) {
    return { success: false, error: `API ${response.status}` };
  }

  const data: unknown = await response.json();
  const reviews = extractReviewsFromResponse(data);
  const dataObject = data as Record<string, unknown>;
  const total = typeof dataObject.numberReviews === "number"
    ? dataObject.numberReviews
    : reviews.length;

  return { success: true, reviews, total };
}

/** Perform a moderation action on a review (abuse report, change request, or respond). */
export async function moderateReview(
  source: ReviewSource,
  action: ModerationAction,
  token: string,
  payload: ModerationPayload
): Promise<ModerateReviewResult> {
  const baseUrl = getBaseUrl(source);
  const tenantId = TENANT_IDS[source];

  let endpoint: string;
  let method: string;
  let requestBody: Record<string, unknown>;

  if (action === "abuse") {
    endpoint = `${baseUrl}/review/abuse`;
    method = "PUT";
    requestBody = {
      locationId: payload.locationId,
      tenantId,
      reviewId: payload.reviewId,
      abuseReason: payload.reasonAbuse || "FAKE_REVIEW",
    };
  } else if (action === "changerequest") {
    endpoint = `${baseUrl}/review/changerequest`;
    method = "PUT";
    requestBody = {
      locationId: payload.locationId,
      tenantId,
      reviewId: payload.reviewId,
    };
  } else if (action === "respond") {
    endpoint = `${baseUrl}/review/external/response`;
    method = "POST";
    requestBody = {
      locationId: payload.locationId,
      tenantId,
      reviewId: payload.reviewId,
      response: payload.response,
      respondentEmail: payload.respondentEmail,
    };
  } else {
    return { success: false, error: "Unknown action", statusCode: 400 };
  }

  const response = await fetch(endpoint, {
    method,
    headers: {
      "X-Publication-Api-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let errorMessage = `API error: ${response.status}`;

    try {
      const errorJson = JSON.parse(responseText);
      const parsedMessage = errorJson.message || errorJson.error;
      const detailedMessage = errorJson.detailedError?.[0]?.message;
      if (parsedMessage) {
        errorMessage = parsedMessage;
      } else if (detailedMessage) {
        errorMessage = detailedMessage;
      }
    } catch {
      // Response was not JSON — use default error message
    }

    return { success: false, error: errorMessage, statusCode: response.status };
  }

  return { success: true, action };
}

/** Aggregate pending reviews across all locations for both platforms. */
export async function fetchPendingReviews(
  tokens: ReviewPlatformTokens,
  options?: { loadAll?: boolean }
): Promise<FetchPendingReviewsResult> {
  if (!tokens.kiyohToken && !tokens.kvToken) {
    return { success: false, error: "No API tokens configured" };
  }

  const loadAll = options?.loadAll || false;

  // Step 1: Fetch locations from both platforms
  const locationResults = await Promise.all([
    tokens.kiyohToken
      ? fetchLocations("kiyoh", tokens.kiyohToken)
      : Promise.resolve({ success: true as const, locations: [] as ReadonlyArray<LocationEntry> }),
    tokens.kvToken
      ? fetchLocations("kv", tokens.kvToken)
      : Promise.resolve({ success: true as const, locations: [] as ReadonlyArray<LocationEntry> }),
  ]);

  const kiyohLocations = locationResults[0].success ? locationResults[0].locations : [];
  const kvLocations = locationResults[1].success ? locationResults[1].locations : [];
  const allLocations = [...kiyohLocations, ...kvLocations];

  // Step 2: Filter to locations with pending reviews (unless loadAll)
  let locationsToCheck: Array<LocationEntry>;
  if (loadAll) {
    locationsToCheck = [...allLocations];
  } else {
    locationsToCheck = allLocations.filter((location) => {
      const pendingCount = location.numberReviewsPending;
      if (typeof pendingCount === "number" && pendingCount > 0) {
        return true;
      }
      return false;
    });
  }

  // Step 3: Sequential fetch with rate limiting
  const pendingReviews: Array<PendingReviewEntry> = [];

  for (let index = 0; index < locationsToCheck.length; index++) {
    const location = locationsToCheck[index];
    const token = getTokenForSource(location.source, tokens);

    if (!token) {
      continue;
    }

    const locationReviews = await fetchPendingForSingleLocation(
      location.source,
      token,
      location.locationId,
      location.locationName
    );
    pendingReviews.push(...locationReviews);

    const isNotLastLocation = index < locationsToCheck.length - 1;
    if (isNotLastLocation) {
      await sleep(RATE_LIMIT_DELAY_MILLISECONDS);
    }
  }

  const data: PendingReviewsData = {
    reviews: pendingReviews,
    total: pendingReviews.length,
    locationCount: allLocations.length,
    locationsChecked: locationsToCheck.length,
    loadedAll: loadAll,
  };

  return { success: true, data };
}

/** Fetch notification count — locations with recent review activity. */
export async function fetchNotificationCount(
  tokens: ReviewPlatformTokens
): Promise<FetchNotificationCountResult> {
  if (!tokens.kiyohToken && !tokens.kvToken) {
    return { success: true, data: { count: 0, updatedLocations: [] } };
  }

  const yesterday = new Date(Date.now() - NOTIFICATION_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const fetchRecentLocations = async (
    source: ReviewSource,
    token: string
  ): Promise<Array<LocationEntry>> => {
    const baseUrl = getBaseUrl(source);
    const url = new URL(`${baseUrl}/review/locations/latest`);
    url.searchParams.set("limit", NOTIFICATION_LOCATIONS_LIMIT);
    url.searchParams.set("updatedSince", yesterday);

    const response = await fetch(url.toString(), {
      headers: { "X-Publication-Api-Token": token },
    });

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();
    const rawLocations = Array.isArray(data)
      ? data
      : ((data as Record<string, unknown>).locations as Array<Record<string, unknown>> || []);

    return rawLocations.map((location: Record<string, unknown>) => ({
      ...location,
      locationId: String(location.locationId || ""),
      locationName: String(location.locationName || location.name || ""),
      source,
    }));
  };

  const [kiyohLocations, kvLocations] = await Promise.all([
    tokens.kiyohToken
      ? fetchRecentLocations("kiyoh", tokens.kiyohToken)
      : Promise.resolve([] as Array<LocationEntry>),
    tokens.kvToken
      ? fetchRecentLocations("kv", tokens.kvToken)
      : Promise.resolve([] as Array<LocationEntry>),
  ]);

  const allUpdatedLocations = [...kiyohLocations, ...kvLocations];

  const uniqueLocationIds = new Set<string>();
  for (const location of allUpdatedLocations) {
    uniqueLocationIds.add(location.locationId);
  }

  return {
    success: true,
    data: {
      count: uniqueLocationIds.size,
      updatedLocations: allUpdatedLocations,
    },
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function fetchPendingForSingleLocation(
  source: ReviewSource,
  token: string,
  locationId: string,
  locationName: string
): Promise<Array<PendingReviewEntry>> {
  const baseUrl = getBaseUrl(source);
  const url = `${baseUrl}/review/external?locationId=${locationId}&orderBy=CREATE_DATE&sortOrder=DESC&limit=${PENDING_REVIEWS_LIMIT}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "X-Publication-Api-Token": token },
      cache: "no-store",
    });
  } catch {
    return [];
  }

  const isRateLimited = response.status === 429;
  if (isRateLimited) {
    return [];
  }

  if (!response.ok) {
    return [];
  }

  const data: unknown = await response.json();
  const allReviews = extractReviewsFromResponse(data);

  const pendingReviews: Array<PendingReviewEntry> = [];

  for (const review of allReviews) {
    const statusValue = String(review.status || review.statusCode || review.reviewStatus || "");
    const isPending = isPendingStatus(statusValue);

    if (isPending) {
      pendingReviews.push({
        ...review,
        locationId,
        locationName,
        source,
        _id: extractReviewId(review),
        _content: extractReviewContent(review),
      });
    }
  }

  return pendingReviews;
}
