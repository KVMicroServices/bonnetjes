import { logger } from "@/lib/logger";
import { authenticateKiyohAdmin } from "./kiyoh-auth-client";

const DEFAULT_KIYOH_REVIEW_LIST_URL = "https://www.klantenvertellen.nl/v1/review";

export interface ReviewerEmailResult {
  readonly success: boolean;
  readonly email?: string;
  readonly error?: string;
}

interface ReviewDto {
  readonly email?: string;
}

interface ReviewListResponse {
  readonly reviews?: ReadonlyArray<ReviewDto>;
}

function getReviewListUrl(): string {
  return process.env.KIYOH_REVIEW_LIST_URL || DEFAULT_KIYOH_REVIEW_LIST_URL;
}

/**
 * Resolves the reviewer's email address from the Kiyoh review API.
 * Never throws — returns a failure result on any error.
 */
export async function resolveReviewerEmail(
  reviewId: string,
  tenantId: number
): Promise<ReviewerEmailResult> {
  let bearerToken: string;

  try {
    const authResult = await authenticateKiyohAdmin();
    bearerToken = authResult.bearerToken;
  } catch (authError) {
    const errorMessage = authError instanceof Error ? authError.message : String(authError);
    logger.error(
      { reviewId, tenantId, error: errorMessage },
      "Failed to authenticate with Kiyoh for reviewer email resolution"
    );
    return { success: false, error: `Authentication failed: ${errorMessage}` };
  }

  const baseUrl = getReviewListUrl();
  const requestUrl = `${baseUrl}?reviewId=${encodeURIComponent(reviewId)}&tenantId=${encodeURIComponent(String(tenantId))}&limit=1`;

  logger.info(
    { url: baseUrl, reviewId, tenantId },
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
      { url: baseUrl, reviewId, tenantId, error: errorMessage },
      "Kiyoh review list fetch threw an exception"
    );
    return { success: false, error: `Network error: ${errorMessage}` };
  }

  if (!response.ok) {
    const responseBody = await response.text();
    logger.error(
      { status: response.status, body: responseBody, reviewId, tenantId },
      "Kiyoh review list API returned non-OK status"
    );
    return { success: false, error: `HTTP ${response.status}: ${responseBody}` };
  }

  let responseData: ReviewListResponse;
  try {
    responseData = (await response.json()) as ReviewListResponse;
  } catch (parseError) {
    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    logger.error(
      { reviewId, tenantId, error: errorMessage },
      "Kiyoh review list response was not valid JSON"
    );
    return { success: false, error: `Invalid JSON response: ${errorMessage}` };
  }

  const reviews = responseData.reviews;
  if (!reviews || reviews.length === 0) {
    logger.warn(
      { reviewId, tenantId },
      "Kiyoh review list returned no reviews"
    );
    return { success: false, error: "No reviews found for the given reviewId" };
  }

  const firstReview = reviews[0];
  const reviewerEmail = firstReview.email;

  if (!reviewerEmail || reviewerEmail.trim().length === 0) {
    logger.warn(
      { reviewId, tenantId },
      "Kiyoh review response missing email field"
    );
    return { success: false, error: "Review found but email field is empty" };
  }

  logger.info(
    { reviewId, tenantId },
    "Successfully resolved reviewer email from Kiyoh API"
  );

  return { success: true, email: reviewerEmail };
}
