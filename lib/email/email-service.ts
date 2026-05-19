import type { Transporter } from "nodemailer";
import { createTransport } from "nodemailer";
import { logger } from "@/lib/logger";
import { loadDisableEmailTranslations } from "@/lib/email/email-translations";
import { renderDisableEmailHtml, renderDisableEmailSubject } from "@/lib/email/email-templates";
import type { DisableEmailData } from "@/lib/email/email-templates";
import { resolveBrandConfig } from "@/lib/email/email-brand";
import { signDisputeToken } from "@/lib/dispute/dispute-token";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SendDisableEmailParams {
  readonly recipientEmail: string;
  readonly locale: string;
  readonly reviewId: string;
  readonly locationId: string;
  readonly tenantId: number;
  readonly failureReason: string;
}

export interface EmailResult {
  readonly success: boolean;
  readonly error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SMTP_HOST_VAR = "SMTP_HOST";
const SMTP_PORT_VAR = "SMTP_PORT";
const SMTP_USER_VAR = "SMTP_USER";
const SMTP_PASS_VAR = "SMTP_PASS";
const SMTP_FROM_VAR = "SMTP_FROM";
const APP_URL_VAR = "APP_URL";

const REQUIRED_SMTP_VARS: readonly string[] = [
  SMTP_HOST_VAR,
  SMTP_PORT_VAR,
  SMTP_USER_VAR,
  SMTP_PASS_VAR,
  SMTP_FROM_VAR,
];

// ─── Singleton Transport ─────────────────────────────────────────────────────

let smtpTransport: Transporter | null = null;

function getSmtpTransport(): Transporter {
  if (smtpTransport) {
    return smtpTransport;
  }

  const host = process.env[SMTP_HOST_VAR];
  const port = Number(process.env[SMTP_PORT_VAR]);
  const user = process.env[SMTP_USER_VAR];
  const pass = process.env[SMTP_PASS_VAR];

  const SECURE_SMTP_PORT = 465;

  smtpTransport = createTransport({
    host: host,
    port: port,
    secure: port === SECURE_SMTP_PORT,
    auth: {
      user: user,
      pass: pass,
    },
  });

  return smtpTransport;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateSmtpConfig(): EmailResult | null {
  const missingVars: string[] = [];

  for (const varName of REQUIRED_SMTP_VARS) {
    const value = process.env[varName];
    if (!value || value.trim().length === 0) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    const errorMessage = `Missing required SMTP environment variables: ${missingVars.join(", ")}`;
    logger.error({ missingVars }, errorMessage);
    return { success: false, error: errorMessage };
  }

  return null;
}

function getAppUrl(): string {
  const rawAppUrl = process.env[APP_URL_VAR];
  const resolved = rawAppUrl ? rawAppUrl : "";
  const trimmed = resolved.trim().replace(/\/$/, "");
  if (trimmed.length === 0) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildDisputeUrl(params: {
  readonly reviewId: string;
  readonly locationId: string;
  readonly tenantId: number;
  readonly failureReason: string;
  readonly appUrl: string;
}): string {
  const token = signDisputeToken({
    reviewId: params.reviewId,
    tenantId: params.tenantId,
    locationId: params.locationId,
    failureReason: params.failureReason,
  });

  return `${params.appUrl}/dispute?token=${encodeURIComponent(token)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function sendReviewDisableEmail(
  params: SendDisableEmailParams
): Promise<EmailResult> {
  try {
    const validationFailure = validateSmtpConfig();
    if (validationFailure) {
      return validationFailure;
    }

    const appUrl = getAppUrl();
    const brand = resolveBrandConfig(params.tenantId);
    const translations = loadDisableEmailTranslations(params.locale, params.failureReason);

    const disputeUrl = buildDisputeUrl({
      reviewId: params.reviewId,
      locationId: params.locationId,
      tenantId: params.tenantId,
      failureReason: params.failureReason,
      appUrl: appUrl,
    });

    const emailData: DisableEmailData = {
      reviewId: params.reviewId,
      locationId: params.locationId,
      disputeUrl: disputeUrl,
      translations: translations,
      brand: brand,
    };

    const subject = renderDisableEmailSubject(emailData);
    const htmlBody = renderDisableEmailHtml(emailData);
    const fromAddress = process.env[SMTP_FROM_VAR];

    const transport = getSmtpTransport();

    await transport.sendMail({
      from: fromAddress,
      to: params.recipientEmail,
      subject: subject,
      html: htmlBody,
    });

    logger.info(
      { recipientEmail: params.recipientEmail, reviewId: params.reviewId, tenantId: params.tenantId },
      "Review disable notification email sent successfully"
    );

    return { success: true };
  } catch (error) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = "Unknown email transport error";
    }
    logger.error(
      { recipientEmail: params.recipientEmail, reviewId: params.reviewId, error: errorMessage },
      "Failed to send review disable notification email"
    );
    return { success: false, error: errorMessage };
  }
}
