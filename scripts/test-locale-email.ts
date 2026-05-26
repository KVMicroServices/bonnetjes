/**
 * Test script: sends a review disable email using the location's locale
 * fetched from the Kiyoh API.
 *
 * Usage:
 *   npx tsx scripts/test-locale-email.ts
 */

import { resolveLocationLocaleWithFallback } from "@/lib/review-disable/kiyoh-location-client";
import { sendReviewDisableEmail } from "@/lib/email/email-service";

const RECIPIENT_EMAIL = "christiaan.visser@kiyoh.co.za";
const LOCATION_ID = "1080586";
const TENANT_ID = 98;
const REVIEW_ID = "test-locale-email-001";
const FAILURE_REASON = "VERIFICATION_FAILED";

async function main(): Promise<void> {
  console.log("Resolving location locale...");
  console.log(`  locationId: ${LOCATION_ID}`);
  console.log(`  tenantId: ${TENANT_ID}`);

  const locale = await resolveLocationLocaleWithFallback(LOCATION_ID, TENANT_ID);
  console.log(`  resolved locale: ${locale}`);

  console.log("");
  console.log("Sending test disable email...");
  console.log(`  to: ${RECIPIENT_EMAIL}`);
  console.log(`  locale: ${locale}`);

  const result = await sendReviewDisableEmail({
    recipientEmail: RECIPIENT_EMAIL,
    locale: locale,
    reviewId: REVIEW_ID,
    locationId: LOCATION_ID,
    tenantId: TENANT_ID,
    failureReason: FAILURE_REASON,
  });

  if (result.success) {
    console.log("\nEmail sent successfully.");
  } else {
    console.error(`\nEmail failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
