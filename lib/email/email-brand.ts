// ─── Tenant-Aware Brand Configuration ────────────────────────────────────────
//
// Resolves brand identity for outbound transactional emails based on the
// originating review platform tenant. Tenant 98 is Kiyoh; every other tenant
// (currently 99) maps to Klantenvertellen.

const KIYOH_TENANT_ID = 98;

const KIYOH_LOGO_PATH = "/kiyoh-logo.png";
const KLANTENVERTELLEN_LOGO_PATH = "/klantenvertellen-logo.jpg";

const KIYOH_TERMS_URL =
  "https://www.kiyoh.com/consumer/terms-of-use-customer-rating-system";
const KLANTENVERTELLEN_TERMS_URL =
  "https://www.klantenvertellen.nl/gebruiksvoorwaarden-klantbeoordelingssysteem/";

const KIYOH_SUPPORT_EMAIL = "support@kiyoh.com";
const KLANTENVERTELLEN_SUPPORT_EMAIL = "support@klantenvertellen.nl";

const KIYOH_BRAND_NAME = "Kiyoh";
const KLANTENVERTELLEN_BRAND_NAME = "Klantenvertellen";

const BANNER_IMAGE_URL =
  "https://kiyoh.com/wp-content/uploads/AdobeStock_262582377-scaled-e1599809135705.jpg";

export interface BrandConfig {
  readonly brandName: string;
  readonly logoUrl: string;
  readonly bannerImageUrl: string;
  readonly termsUrl: string;
  readonly supportEmail: string;
}

function buildAbsoluteUrl(appUrl: string, path: string): string {
  const trimmedAppUrl = appUrl.replace(/\/$/, "");
  return `${trimmedAppUrl}${path}`;
}

export function resolveBrandConfig(tenantId: number, appUrl: string): BrandConfig {
  if (tenantId === KIYOH_TENANT_ID) {
    return {
      brandName: KIYOH_BRAND_NAME,
      logoUrl: buildAbsoluteUrl(appUrl, KIYOH_LOGO_PATH),
      bannerImageUrl: BANNER_IMAGE_URL,
      termsUrl: KIYOH_TERMS_URL,
      supportEmail: KIYOH_SUPPORT_EMAIL,
    };
  }

  return {
    brandName: KLANTENVERTELLEN_BRAND_NAME,
    logoUrl: buildAbsoluteUrl(appUrl, KLANTENVERTELLEN_LOGO_PATH),
    bannerImageUrl: BANNER_IMAGE_URL,
    termsUrl: KLANTENVERTELLEN_TERMS_URL,
    supportEmail: KLANTENVERTELLEN_SUPPORT_EMAIL,
  };
}
