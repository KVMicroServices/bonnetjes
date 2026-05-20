import type { Transporter } from "nodemailer";
import { createTransport } from "nodemailer";
import { logger } from "@/lib/logger";
import { loadDisableEmailTranslations } from "@/lib/email/email-translations";
import { renderDisableEmailHtml, renderDisableEmailSubject } from "@/lib/email/email-templates";
import type { DisableEmailData } from "@/lib/email/email-templates";
import { resolveBrandConfig } from "@/lib/email/email-brand";
import { signDisputeToken } from "@/lib/dispute/dispute-token";
import { getSmtpSettings } from "@/lib/services/app-settings-service";

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

const APP_URL_VAR = "APP_URL";

// ─── Transport Factory ───────────────────────────────────────────────────────

interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
}

function createSmtpTransport(config: SmtpConfig): Transporter {
  const SECURE_SMTP_PORT = 465;

  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === SECURE_SMTP_PORT,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveSmtpConfig(): Promise<SmtpConfig | null> {
  const smtp = await getSmtpSettings();

  if (!smtp.smtpHost || !smtp.smtpPort || !smtp.smtpUser || !smtp.smtpPass || !smtp.smtpFrom) {
    const missingFields: string[] = [];
    if (!smtp.smtpHost) { missingFields.push("SMTP_HOST"); }
    if (!smtp.smtpPort) { missingFields.push("SMTP_PORT"); }
    if (!smtp.smtpUser) { missingFields.push("SMTP_USER"); }
    if (!smtp.smtpPass) { missingFields.push("SMTP_PASS"); }
    if (!smtp.smtpFrom) { missingFields.push("SMTP_FROM"); }
    logger.error({ missingFields }, `Missing required SMTP configuration: ${missingFields.join(", ")}`);
    return null;
  }

  return {
    host: smtp.smtpHost,
    port: Number(smtp.smtpPort),
    user: smtp.smtpUser,
    pass: smtp.smtpPass,
    from: smtp.smtpFrom,
  };
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
    const smtpConfig = await resolveSmtpConfig();
    if (!smtpConfig) {
      return { success: false, error: "SMTP not configured" };
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

    const transport = createSmtpTransport(smtpConfig);

    await transport.sendMail({
      from: smtpConfig.from,
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
