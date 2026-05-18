// ─── Types ───────────────────────────────────────────────────────────────────

export interface DisableEmailData {
  readonly reviewId: string;
  readonly locationId: string;
  readonly failureReason: string;
  readonly disputeUrl: string;
  readonly translations: {
    readonly subject: string;
    readonly greeting: string;
    readonly body: string;
    readonly reasonLabel: string;
    readonly disputeButtonText: string;
    readonly footer: string;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BACKGROUND_COLOR = "#f4f4f7";
const CONTAINER_COLOR = "#ffffff";
const TEXT_COLOR = "#333333";
const MUTED_TEXT_COLOR = "#666666";
const BUTTON_COLOR = "#1a73e8";
const BUTTON_TEXT_COLOR = "#ffffff";
const BORDER_COLOR = "#e0e0e0";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function interpolateBody(template: string, reviewId: string, locationId: string): string {
  return template
    .replace("{reviewId}", reviewId)
    .replace("{locationId}", locationId);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function renderDisableEmailSubject(data: DisableEmailData): string {
  return data.translations.subject;
}

export function renderDisableEmailHtml(data: DisableEmailData): string {
  const interpolatedBody = interpolateBody(
    data.translations.body,
    data.reviewId,
    data.locationId
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${data.translations.subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${BACKGROUND_COLOR}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${BACKGROUND_COLOR}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color: ${CONTAINER_COLOR}; border-radius: 8px; border: 1px solid ${BORDER_COLOR}; max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 40px 32px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; color: ${TEXT_COLOR}; line-height: 1.5;">
                ${data.translations.greeting}
              </p>
              <p style="margin: 0 0 24px 0; font-size: 16px; color: ${TEXT_COLOR}; line-height: 1.5;">
                ${interpolatedBody}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0; background-color: ${BACKGROUND_COLOR}; border-radius: 4px;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0; font-size: 14px; color: ${MUTED_TEXT_COLOR}; line-height: 1.5;">
                      <strong>${data.translations.reasonLabel}:</strong> ${data.failureReason}
                    </p>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0;">
                <tr>
                  <td align="center" style="border-radius: 4px; background-color: ${BUTTON_COLOR};">
                    <a href="${data.disputeUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; font-size: 16px; color: ${BUTTON_TEXT_COLOR}; text-decoration: none; border-radius: 4px; font-weight: 600;">
                      ${data.translations.disputeButtonText}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 14px; color: ${MUTED_TEXT_COLOR}; line-height: 1.5;">
                ${data.translations.footer}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return html;
}
