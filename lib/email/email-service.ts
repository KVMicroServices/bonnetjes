import type { Transporter } from "nodemailer";
import { createTransport } from "nodemailer";
import { logger } from "@/lib/logger";
import { loadDisableEmailTranslations } from "@/lib/email/email-translations";
import { renderDisableEmailHtml, renderDisableEmailSubject } from "@/lib/email/email-templates";
import type { DisableEmailData } from "@/lib/email/email-templates";
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

  smtpTransport = createTransport({
    host: host,
    port: port,
    secure: port === 465,
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

function buildDisputeUrl(params: {
  readonly reviewId: string;
  readonly locationId: string;
  readonly tenantId: number;
  readonly failureReason: string;
}): string {
  const appUrl = process.env[APP_URL_VAR] || "";
  const trimmedAppUrl = appUrl.replace(/\/$/, "");

  const token = signDisputeToken({
    reviewId: params.reviewId,
    tenantId: params.tenantId,
    locationId: params.locationId,
    failureReason: params.failureReason,
  });

  return `${trimmedAppUrl}/dispute?token=${encodeURIComponent(token)}`;
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

    const translations = loadDisableEmailTranslations(params.locale, params.failureReason);
    const disputeUrl = buildDisputeUrl({
      reviewId: params.reviewId,
      locationId: params.locationId,
      tenantId: params.tenantId,
      failureReason: params.failureReason,
    });

    const emailData: DisableEmailData = {
      reviewId: params.reviewId,
      locationId: params.locationId,
      failureReason: translations.failureReasonText,
      disputeUrl: disputeUrl,
      translations: {
        subject: translations.subject,
        greeting: translations.greeting,
        body: translations.body,
        reasonLabel: translations.reasonLabel,
        disputeButtonText: translations.disputeButtonText,
        footer: translations.footer,
      },
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
      { recipientEmail: params.recipientEmail, reviewId: params.reviewId },
      "Review disable notification email sent successfully"
    );

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown email transport error";
    logger.error(
      { recipientEmail: params.recipientEmail, reviewId: params.reviewId, error: errorMessage },
      "Failed to send review disable notification email"
    );
    return { success: false, error: errorMessage };
  }
}
