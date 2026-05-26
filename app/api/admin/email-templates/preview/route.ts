export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { getDefaultValues } from "@/lib/services/email-template-override-service";
import {
  renderDisableEmailHtml,
  renderDisableEmailSubject,
  renderVerifiedEmailHtml,
  renderVerifiedEmailSubject,
  renderFinalRejectionEmailHtml,
  renderFinalRejectionEmailSubject,
} from "@/lib/email/email-templates";
import type {
  DisableEmailData,
  VerifiedEmailData,
  FinalRejectionEmailData,
} from "@/lib/email/email-templates";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  email: string;
  role: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_EMAIL_TYPES = ["disable", "verified", "disputeVerified", "finalRejection"] as const;
const MAXIMUM_VALUE_LENGTH = 2000;

const SAMPLE_BRAND = {
  brandName: "ReviewReceipts",
  logoUrl: "/kiyoh-logo.png",
  bannerImageUrl: "https://kiyoh.com/wp-content/uploads/AdobeStock_262582377-scaled-e1599809135705.jpg",
  termsUrl: "https://www.klantenvertellen.nl/en/terms-of-use-customer-review-system/",
  privacyPolicyUrl: "https://kiyoh.com/privacy/",
  supportEmail: "support@reviewreceipts.com",
} as const;

const SAMPLE_REVIEW_ID = "preview-review-123";
const SAMPLE_LOCATION_ID = "preview-location-456";
const SAMPLE_DISPUTE_URL = "https://example.com/dispute/preview-token";
const SAMPLE_SHOP_NAME = "Example Shop";
const SAMPLE_DATE = "2025-01-15";
const SAMPLE_AMOUNT = 49.99;
const SAMPLE_FAILURE_REASON_TEXT = "The receipt image was unclear and could not be verified.";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const previewBodySchema = z.object({
  emailType: z.enum(VALID_EMAIL_TYPES),
  overrides: z.record(z.string(), z.string().max(MAXIMUM_VALUE_LENGTH)),
});

// ─── Auth Helper ─────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<{ authorized: true } | { authorized: false; response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { authorized: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const isAdmin = (session.user as SessionUser).role === "admin";
  if (!isAdmin) {
    return { authorized: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }

  return { authorized: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeOverridesWithDefaults(emailType: string, overrides: Record<string, string>): Record<string, string> {
  const defaults = getDefaultValues(emailType);
  const merged: Record<string, string> = { ...defaults };

  for (const key of Object.keys(overrides)) {
    if (overrides[key] !== "") {
      merged[key] = overrides[key];
    }
  }

  return merged;
}

function renderPreviewForDisable(translations: Record<string, string>): { subject: string; html: string } {
  let failureReasonText: string;
  if (translations.failureReasonText) {
    failureReasonText = translations.failureReasonText;
  } else {
    failureReasonText = SAMPLE_FAILURE_REASON_TEXT;
  }

  const data: DisableEmailData = {
    reviewId: SAMPLE_REVIEW_ID,
    locationId: SAMPLE_LOCATION_ID,
    disputeUrl: SAMPLE_DISPUTE_URL,
    translations: {
      ...translations,
      failureReasonText,
    } as DisableEmailData["translations"],
    brand: SAMPLE_BRAND,
  };

  return {
    subject: renderDisableEmailSubject(data),
    html: renderDisableEmailHtml(data),
  };
}

function renderPreviewForVerified(translations: Record<string, string>): { subject: string; html: string } {
  const data: VerifiedEmailData = {
    reviewId: SAMPLE_REVIEW_ID,
    extractedShopName: SAMPLE_SHOP_NAME,
    extractedDate: SAMPLE_DATE,
    extractedAmount: SAMPLE_AMOUNT,
    translations: translations as unknown as VerifiedEmailData["translations"],
    brand: SAMPLE_BRAND,
  };

  return {
    subject: renderVerifiedEmailSubject(data),
    html: renderVerifiedEmailHtml(data),
  };
}

function renderPreviewForFinalRejection(translations: Record<string, string>): { subject: string; html: string } {
  const data: FinalRejectionEmailData = {
    reviewId: SAMPLE_REVIEW_ID,
    failureReasonText: SAMPLE_FAILURE_REASON_TEXT,
    translations: translations as unknown as FinalRejectionEmailData["translations"],
    brand: SAMPLE_BRAND,
  };

  return {
    subject: renderFinalRejectionEmailSubject(data),
    html: renderFinalRejectionEmailHtml(data),
  };
}

// ─── POST: Render email preview ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.authorized) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = previewBodySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid request body", details: parseResult.error.flatten() }, { status: 400 });
  }

  const { emailType, overrides } = parseResult.data;

  try {
    const merged = mergeOverridesWithDefaults(emailType, overrides);

    let result: { subject: string; html: string };

    if (emailType === "disable") {
      result = renderPreviewForDisable(merged);
    } else if (emailType === "verified" || emailType === "disputeVerified") {
      result = renderPreviewForVerified(merged);
    } else {
      result = renderPreviewForFinalRejection(merged);
    }

    return NextResponse.json(result);
  } catch (error) {
    logger.error({ error, emailType }, "Failed to render email preview");
    return NextResponse.json({ error: "Failed to render email preview" }, { status: 500 });
  }
}
