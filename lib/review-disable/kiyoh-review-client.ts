import { logger } from "@/lib/logger";
import { authenticateKiyohAdmin, invalidateKiyohTokenCache } from "./kiyoh-auth-client";

// ─── Constants ───────────────────────────────────────────────────────────────

const KIYOH_REVIEW_BASE_URL = "https://www.kiyoh.com/v1/review";
const KLANTENVERTELLEN_REVIEW_BASE_URL = "https://www.klantenvertellen.nl/v1/review";
const KIYOH_TENANT_ID = 98;
const HTTP_UNAUTHORIZED = 401;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReviewerEmailResult {
  readonly success: boolean;
  readonly email?: string;
  readonly error?: string;
}

interface ReviewDetailDto {
  readonly email?: string;
  readonly reviewId?: string;
  readonly locationId?: string;
  readonly tenantId?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getReviewListBaseUrl(tenantId: number): string {
  const envOverride = process.env.KIYOH_REVIEW_LIST_URL;
  if (envOverride) {
    return envOverride;
  }

  if (tenantId === KIYOH_TENANT_ID) {
    return KIYOH_REVIEW_BASE_URL;
  }

  return KLANTENVERTELLEN_REVIEW_BASE_URL;
}

/**
 * Resolves the reviewer's email address from the Kiyoh review API.
 * Never throws — returns a failure result on any error.
 * Retries once on 401 by invalidating the cached token and re-authenticating.
 */
export async function resolveReviewerEmail(
  reviewId: string,
  locationId: string,
  tenantId: number
): Promise<ReviewerEmailResult> {
  const firstAttempt = await fetchReviewerEmail(reviewId, locationId, tenantId);

  if (firstAttempt.retryDueToExpiredToken) {
    logger.info(
      { reviewId, locationId, tenantId },
      "Kiyoh review API returned 401, invalidating token cache and retrying"
    );
    invalidateKiyohTokenCache();
    const retryAttempt = await fetchReviewerEmail(reviewId, locationId, tenantId);
    return retryAttempt.result;
  }

  return firstAttempt.result;
}

// ─── Internal Fetch ──────────────────────────────────────────────────────────

interface FetchReviewerEmailOutcome {
  readonly result: ReviewerEmailResult;
  readonly retryDueToExpiredToken: boolean;
}

async function fetchReviewerEmail(
  reviewId: string,
  locationId: string,
  tenantId: number
): Promise<FetchReviewerEmailOutcome> {
  let bearerToken: string;

  try {
    const authResult = await authenticateKiyohAdmin();
    bearerToken = authResult.bearerToken;
  } catch (authError) {
    let errorMessage: string;
    if (authError instanceof Error) {
      errorMessage = authError.message;
    } else {
      errorMessage = String(authError);
    }
    logger.error(
      { reviewId, locationId, tenantId, error: errorMessage },
      "Failed to authenticate with Kiyoh for reviewer email resolution"
    );
    return {
      result: { success: false, error: `Authentication failed: ${errorMessage}` },
      retryDueToExpiredToken: false,
    };
  }

  const baseUrl = getReviewListBaseUrl(tenantId);
  const requestUrl = `${baseUrl}?reviewId=${encodeURIComponent(reviewId)}&locationId=${encodeURIComponent(locationId)}&tenantId=${encodeURIComponent(String(tenantId))}`;

  logger.info(
    { url: baseUrl, reviewId, locationId, tenantId },
    "Fetching reviewer email from Kiyoh review API"
  );

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });
  } catch (fetchError) {
    let errorMessage: string;
    if (fetchError instanceof Error) {
      errorMessage = fetchError.message;
    } else {
      errorMessage = String(fetchError);
    }
    logger.error(
      { url: baseUrl, reviewId, locationId, tenantId, error: errorMessage },
      "Kiyoh review list fetch threw an exception"
    );
    return {
      result: { success: false, error: `Network error: ${errorMessage}` },
      retryDueToExpiredToken: false,
    };
  }

  if (response.status === HTTP_UNAUTHORIZED) {
    let responseBody: string;
    try {
      responseBody = await response.text();
    } catch {
      responseBody = "(failed to read response body)";
    }
    logger.warn(
      { status: response.status, body: responseBody, reviewId, locationId, tenantId },
      "Kiyoh review list API returned 401, token may be expired"
    );
    return {
      result: { success: false, error: `HTTP ${response.status}: ${responseBody}` },
      retryDueToExpiredToken: true,
    };
  }

  if (!response.ok) {
    let responseBody: string;
    try {
      responseBody = await response.text();
    } catch {
      responseBody = "(failed to read response body)";
    }
    logger.error(
      { status: response.status, body: responseBody, reviewId, locationId, tenantId },
      "Kiyoh review list API returned non-OK status"
    );
    return {
      result: { success: false, error: `HTTP ${response.status}: ${responseBody}` },
      retryDueToExpiredToken: false,
    };
  }

  let responseData: ReadonlyArray<ReviewDetailDto>;
  try {
    const parsed = await response.json();
    if (!Array.isArray(parsed)) {
      logger.warn(
        { reviewId, locationId, tenantId },
        "Kiyoh review API returned non-array response"
      );
      return {
        result: { success: false, error: "Unexpected response format (not an array)" },
        retryDueToExpiredToken: false,
      };
    }
    responseData = parsed as ReadonlyArray<ReviewDetailDto>;
  } catch (parseError) {
    let errorMessage: string;
    if (parseError instanceof Error) {
      errorMessage = parseError.message;
    } else {
      errorMessage = String(parseError);
    }
    logger.error(
      { reviewId, locationId, tenantId, error: errorMessage },
      "Kiyoh review list response was not valid JSON"
    );
    return {
      result: { success: false, error: `Invalid JSON response: ${errorMessage}` },
      retryDueToExpiredToken: false,
    };
  }

  if (responseData.length === 0) {
    logger.warn(
      { reviewId, locationId, tenantId },
      "Kiyoh review list returned no reviews"
    );
    return {
      result: { success: false, error: "No reviews found for the given reviewId" },
      retryDueToExpiredToken: false,
    };
  }

  const firstReview = responseData[0];
  const reviewerEmail = firstReview.email;

  if (!reviewerEmail || reviewerEmail.trim().length === 0) {
    logger.warn(
      { reviewId, locationId, tenantId },
      "Kiyoh review response missing email field"
    );
    return {
      result: { success: false, error: "Review found but email field is empty" },
      retryDueToExpiredToken: false,
    };
  }

  logger.info(
    { reviewId, locationId, tenantId },
    "Successfully resolved reviewer email from Kiyoh API"
  );

  return {
    result: { success: true, email: reviewerEmail },
    retryDueToExpiredToken: false,
  };
}
