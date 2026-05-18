import { logger } from "@/lib/logger";
import { authenticateKiyohAdmin } from "./kiyoh-auth-client";

// ─── Constants ───────────────────────────────────────────────────────────────

const KIYOH_REVIEW_BASE_URL = "https://www.kiyoh.com/v1/review";
const KLANTENVERTELLEN_REVIEW_BASE_URL = "https://www.klantenvertellen.nl/v1/review";
const KIYOH_TENANT_ID = 98;

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
 */
export async function resolveReviewerEmail(
  reviewId: string,
  locationId: string,
  tenantId: number
): Promise<ReviewerEmailResult> {
  let bearerToken: string;

  try {
    const authResult = await authenticateKiyohAdmin();
    bearerToken = authResult.bearerToken;
  } catch (authError) {
    const errorMessage = authError instanceof Error ? authError.message : String(authError);
    logger.error(
      { reviewId, locationId, tenantId, error: errorMessage },
      "Failed to authenticate with Kiyoh for reviewer email resolution"
    );
    return { success: false, error: `Authentication failed: ${errorMessage}` };
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
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    logger.error(
      { url: baseUrl, reviewId, locationId, tenantId, error: errorMessage },
      "Kiyoh review list fetch threw an exception"
    );
    return { success: false, error: `Network error: ${errorMessage}` };
  }

  if (!response.ok) {
    const responseBody = await response.text();
    logger.error(
      { status: response.status, body: responseBody, reviewId, locationId, tenantId },
      "Kiyoh review list API returned non-OK status"
    );
    return { success: false, error: `HTTP ${response.status}: ${responseBody}` };
  }

  let responseData: ReadonlyArray<ReviewDetailDto>;
  try {
    const parsed = await response.json();
    if (!Array.isArray(parsed)) {
      logger.warn(
        { reviewId, locationId, tenantId },
        "Kiyoh review API returned non-array response"
      );
      return { success: false, error: "Unexpected response format (not an array)" };
    }
    responseData = parsed as ReadonlyArray<ReviewDetailDto>;
  } catch (parseError) {
    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    logger.error(
      { reviewId, locationId, tenantId, error: errorMessage },
      "Kiyoh review list response was not valid JSON"
    );
    return { success: false, error: `Invalid JSON response: ${errorMessage}` };
  }

  if (responseData.length === 0) {
    logger.warn(
      { reviewId, locationId, tenantId },
      "Kiyoh review list returned no reviews"
    );
    return { success: false, error: "No reviews found for the given reviewId" };
  }

  const firstReview = responseData[0];
  const reviewerEmail = firstReview.email;

  if (!reviewerEmail || reviewerEmail.trim().length === 0) {
    logger.warn(
      { reviewId, locationId, tenantId },
      "Kiyoh review response missing email field"
    );
    return { success: false, error: "Review found but email field is empty" };
  }

  logger.info(
    { reviewId, locationId, tenantId },
    "Successfully resolved reviewer email from Kiyoh API"
  );

  return { success: true, email: reviewerEmail };
}
