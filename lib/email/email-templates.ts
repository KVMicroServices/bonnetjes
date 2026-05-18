// ─── Types ───────────────────────────────────────────────────────────────────

export interface DisableEmailTranslations {
  readonly subject: string;
  readonly headerTagline: string;
  readonly headerTitle: string;
  readonly greeting: string;
  readonly intro: string;
  readonly guidelinesLinkText: string;
  readonly requirementsIntro: string;
  readonly requirementCompanyName: string;
  readonly requirementDate: string;
  readonly requirementOrderNumber: string;
  readonly requirementCustomerName: string;
  readonly disputePrompt: string;
  readonly disputeButtonText: string;
  readonly signOff: string;
  readonly teamName: string;
  readonly termsButtonText: string;
  readonly privacyButtonText: string;
  readonly questionsLabel: string;
  readonly reasonLabel: string;
  readonly failureReasonText: string;
}

export interface DisableEmailBrand {
  readonly brandName: string;
  readonly logoUrl: string;
  readonly bannerImageUrl: string;
  readonly termsUrl: string;
  readonly privacyPolicyUrl: string;
  readonly supportEmail: string;
}

export interface DisableEmailData {
  readonly reviewId: string;
  readonly locationId: string;
  readonly disputeUrl: string;
  readonly translations: DisableEmailTranslations;
  readonly brand: DisableEmailBrand;
}

// ─── Style Constants ─────────────────────────────────────────────────────────

const PAGE_BACKGROUND = "#FAFAFA";
const CARD_BACKGROUND = "#ffffff";
const TEXT_COLOR = "#333333";
const MUTED_TEXT_COLOR = "#888888";
const PRIMARY_BUTTON_COLOR = "#68b03d";
const SECONDARY_BUTTON_COLOR = "#dd6825";
const FOOTER_BORDER_COLOR = "#e0e0e0";
const BANNER_FALLBACK_COLOR = "#cccccc";

const CARD_RADIUS_PX = 20;
const BANNER_RADIUS_TOP_PX = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBannerCell(brand: DisableEmailBrand): string {
  const escapedBrandName = escapeHtml(brand.brandName);
  const bannerStyle = [
    `background-color:${BANNER_FALLBACK_COLOR}`,
    `background-image:url('${brand.bannerImageUrl}')`,
    "background-size:cover",
    "background-repeat:no-repeat",
    "background-position:center center",
    `border-top-left-radius:${BANNER_RADIUS_TOP_PX}px`,
    `border-top-right-radius:${BANNER_RADIUS_TOP_PX}px`,
    "height:160px",
  ].join(";");

  return `
    <td align="top" valign="top" style="${bannerStyle};">
      <table align="right" border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
        <tr>
          <td align="right" valign="top" style="padding:20px;">
            <img alt="${escapedBrandName}" src="${brand.logoUrl}" style="display:block;width:180px;height:auto;" width="180" />
          </td>
        </tr>
      </table>
    </td>`;
}

function renderMainCard(data: DisableEmailData): string {
  const translations = data.translations;
  const cardStyle = [
    `background-color:${CARD_BACKGROUND}`,
    `border-radius:${CARD_RADIUS_PX}px`,
    "padding:20px",
    "text-align:center",
    "box-shadow:0 8px 20px rgba(0,0,0,0.05)",
  ].join(";");

  const guidelinesLink = `<a href="${data.brand.termsUrl}" style="color:${PRIMARY_BUTTON_COLOR};font-weight:bold;text-decoration:none;" target="_blank">${escapeHtml(translations.guidelinesLinkText)}</a>`;

  const introParagraph = translations.intro.replace(
    "{guidelinesLink}",
    guidelinesLink
  );

  const reasonStyle = [
    "background-color:#f9f9f9",
    "border-radius:8px",
    "padding:12px 16px",
    "margin:0 0 24px 0",
    "text-align:left",
    `color:${TEXT_COLOR}`,
    "font-size:14px",
    "line-height:1.5",
  ].join(";");

  return `
    <td style="${cardStyle}">
      <h1 style="font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;color:${TEXT_COLOR};margin:0;">
        <span style="font-size:22px">${escapeHtml(translations.headerTagline)}</span><br />
        <span style="font-size:32px">${escapeHtml(translations.headerTitle)}</span>
      </h1>
      <div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>
      <p style="text-align:left;font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;font-size:16px;line-height:1.6;color:${TEXT_COLOR};margin:15px 0;">
        ${escapeHtml(translations.greeting)}
      </p>
      <p style="text-align:left;font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;font-size:16px;line-height:1.6;color:${TEXT_COLOR};margin:15px 0;">
        ${introParagraph}
      </p>
      <p style="text-align:left;font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;font-size:16px;line-height:1.6;color:${TEXT_COLOR};margin:15px 0;">
        ${escapeHtml(translations.requirementsIntro)}
      </p>
      <ul style="text-align:left;margin:0 0 25px 0;padding-left:20px;font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;font-size:16px;line-height:1.6;color:${TEXT_COLOR};">
        <li>${escapeHtml(translations.requirementCompanyName)}</li>
        <li>${escapeHtml(translations.requirementDate)}</li>
        <li>${escapeHtml(translations.requirementOrderNumber)}</li>
        <li>${escapeHtml(translations.requirementCustomerName)}</li>
      </ul>
      <div style="${reasonStyle}">
        <strong>${escapeHtml(translations.reasonLabel)}:</strong> ${escapeHtml(translations.failureReasonText)}
      </div>
      <p style="text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;font-size:16px;line-height:1.6;color:${TEXT_COLOR};margin:15px 0;">
        ${escapeHtml(translations.disputePrompt)}
      </p>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:20px auto 0 auto;">
        <tr>
          <td align="center" style="border-radius:30px;background-color:${PRIMARY_BUTTON_COLOR};">
            <a href="${escapeHtml(data.disputeUrl)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;font-size:16px;color:#ffffff;text-decoration:none;border-radius:30px;font-weight:bold;">${escapeHtml(translations.disputeButtonText)}</a>
          </td>
        </tr>
      </table>
    </td>`;
}

function renderFooterCard(data: DisableEmailData): string {
  const translations = data.translations;
  const brand = data.brand;

  const cardStyle = [
    `background-color:${CARD_BACKGROUND}`,
    `border-radius:${CARD_RADIUS_PX}px`,
    "padding:20px",
    "text-align:center",
    "box-shadow:0 8px 20px rgba(0,0,0,0.05)",
  ].join(";");

  const termsButtonStyle = [
    `background-color:${SECONDARY_BUTTON_COLOR}`,
    "color:#ffffff",
    "padding:10px 20px",
    "text-decoration:none",
    "border-radius:5px",
    "display:inline-block",
    "font-weight:bold",
    "font-family:Arial, sans-serif",
  ].join(";");

  return `
    <td style="${cardStyle}">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-top:1px solid ${FOOTER_BORDER_COLOR};padding-top:20px;" width="100%">
        <tr>
          <td style="text-align:center;">
            <p style="margin:0;font-size:20px;color:${TEXT_COLOR};font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;">
              ${escapeHtml(translations.signOff)}<br />
              <strong>${escapeHtml(translations.teamName)}</strong>
            </p>
            <div style="margin:20px 0;">
              <a href="${brand.termsUrl}" target="_blank" style="${termsButtonStyle}">
                ${escapeHtml(translations.termsButtonText)}
              </a>
              &nbsp;&nbsp;
              <a href="${brand.privacyPolicyUrl}" target="_blank" style="${termsButtonStyle}">
                ${escapeHtml(translations.privacyButtonText)}
              </a>
            </div>
            <p style="font-size:14px;color:${MUTED_TEXT_COLOR};font-family:'Helvetica Neue',Helvetica,Arial,Verdana,sans-serif;">
              ${escapeHtml(translations.questionsLabel)}
              <a href="mailto:${brand.supportEmail}" style="color:${SECONDARY_BUTTON_COLOR};text-decoration:none;" target="_blank">${escapeHtml(brand.supportEmail)}</a>
            </p>
          </td>
        </tr>
      </table>
    </td>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function renderDisableEmailSubject(data: DisableEmailData): string {
  return data.translations.subject;
}

export function renderDisableEmailHtml(data: DisableEmailData): string {
  const escapedSubject = escapeHtml(data.translations.subject);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedSubject}</title>
</head>
<body style="margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;width:100%;background-color:${PAGE_BACKGROUND};">
  <center>
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse !important;margin:0;padding:0;width:100%;background-color:${PAGE_BACKGROUND};">
      <tr>
        <td align="center" valign="top" style="padding:20px;width:100%;background-color:${PAGE_BACKGROUND};">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px !important;">
            <tr>${renderBannerCell(data.brand)}</tr>
            <tr>${renderMainCard(data)}</tr>
            <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>
            <tr>${renderFooterCard(data)}</tr>
            <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;
}
