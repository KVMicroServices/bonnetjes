import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { authenticateKiyohAdmin, invalidateKiyohTokenCache } from "./kiyoh-auth-client";

const KLANTENVERTELLEN_REVIEW_ACTIVE_URL = "https://www.klantenvertellen.nl/v1/review/active";
const HTTP_UNAUTHORIZED = 401;

export interface DisableByReceiptResult {
  readonly success: boolean;
  readonly reviewId?: string;
  readonly error?: string;
}

export interface DisableByReviewIdResult {
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Sets the active status of a review on KlantenVertellen.
 * If the first attempt returns 401, invalidates the cached token and retries once.
 */
async function setReviewActiveStatus(
  reviewId: string,
  locationId: string,
  tenantId: number,
  active: boolean
): Promise<{ success: boolean; error?: string }> {
  const { bearerToken } = await authenticateKiyohAdmin();

  const response = await fetch(KLANTENVERTELLEN_REVIEW_ACTIVE_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ locationId, tenantId, reviewId, active }),
  });

  if (response.status === HTTP_UNAUTHORIZED) {
    logger.warn({ reviewId }, "KlantenVertellen returned 401, refreshing token and retrying");
    invalidateKiyohTokenCache();

    const { bearerToken: freshToken } = await authenticateKiyohAdmin();

    const retryResponse = await fetch(KLANTENVERTELLEN_REVIEW_ACTIVE_URL, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${freshToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ locationId, tenantId, reviewId, active }),
    });

    if (!retryResponse.ok) {
      const retryBody = await retryResponse.text();
      logger.error(
        { status: retryResponse.status, body: retryBody, reviewId, active },
        "KlantenVertellen review active update failed after token refresh"
      );
      return { success: false, error: `HTTP ${retryResponse.status}: ${retryBody}` };
    }

    return { success: true };
  }

  if (!response.ok) {
    const responseBody = await response.text();
    logger.error(
      { status: response.status, body: responseBody, reviewId, active },
      "KlantenVertellen review active update failed"
    );
    return { success: false, error: `HTTP ${response.status}: ${responseBody}` };
  }

  return { success: true };
}

/**
 * Looks up ReceiptSyncState by receiptId and returns the review data.
 */
async function lookupSyncState(receiptId: string) {
  const syncState = await prisma.receiptSyncState.findFirst({
    where: { receiptId },
  });
  return syncState;
}

/**
 * Disable review linked to a receipt via ReceiptSyncState lookup.
 */
export async function disableReviewByReceiptId(receiptId: string): Promise<DisableByReceiptResult> {
  const syncState = await lookupSyncState(receiptId);

  if (!syncState) {
    logger.warn({ receiptId }, "No ReceiptSyncState found for receipt, skipping disable");
    return { success: false, error: "No ReceiptSyncState found for receipt" };
  }

  const result = await setReviewActiveStatus(
    syncState.reviewId,
    syncState.locationId,
    syncState.tenantId,
    false
  );

  if (!result.success) {
    return { success: false, reviewId: syncState.reviewId, error: result.error };
  }

  return { success: true, reviewId: syncState.reviewId };
}

/**
 * Enable review linked to a receipt via ReceiptSyncState lookup.
 */
export async function enableReviewByReceiptId(receiptId: string): Promise<DisableByReceiptResult> {
  const syncState = await lookupSyncState(receiptId);

  if (!syncState) {
    logger.warn({ receiptId }, "No ReceiptSyncState found for receipt, skipping enable");
    return { success: false, error: "No ReceiptSyncState found for receipt" };
  }

  const result = await setReviewActiveStatus(
    syncState.reviewId,
    syncState.locationId,
    syncState.tenantId,
    true
  );

  if (!result.success) {
    return { success: false, reviewId: syncState.reviewId, error: result.error };
  }

  return { success: true, reviewId: syncState.reviewId };
}

/**
 * Disable review by direct reviewId/locationId/tenantId (no receipt link needed).
 */
export async function disableReviewManual(
  reviewId: string,
  locationId: string,
  tenantId: number
): Promise<DisableByReviewIdResult> {
  const result = await setReviewActiveStatus(
    reviewId,
    locationId,
    tenantId,
    false
  );

  return result;
}
