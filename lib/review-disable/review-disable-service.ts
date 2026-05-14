import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { authenticateKiyohAdmin } from "./kiyoh-auth-client";

const KLANTENVERTELLEN_REVIEW_ACTIVE_URL = "https://www.klantenvertellen.nl/v1/review/active";

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
 */
async function setReviewActiveStatus(
  reviewId: string,
  locationId: string,
  tenantId: number,
  active: boolean,
  bearerToken: string
): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(KLANTENVERTELLEN_REVIEW_ACTIVE_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ locationId, tenantId, reviewId, active }),
  });

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

  const { bearerToken } = await authenticateKiyohAdmin();

  const result = await setReviewActiveStatus(
    syncState.reviewId,
    syncState.locationId,
    syncState.tenantId,
    false,
    bearerToken
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

  const { bearerToken } = await authenticateKiyohAdmin();

  const result = await setReviewActiveStatus(
    syncState.reviewId,
    syncState.locationId,
    syncState.tenantId,
    true,
    bearerToken
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
  const { bearerToken } = await authenticateKiyohAdmin();

  const result = await setReviewActiveStatus(
    reviewId,
    locationId,
    tenantId,
    false,
    bearerToken
  );

  return result;
}
