// ─── Tenant-Aware Brand Configuration ────────────────────────────────────────
//
// Resolves brand identity for outbound transactional emails based on the
// originating review platform tenant. Tenant 98 is Kiyoh; every other tenant
// (currently 99) maps to Klantenvertellen.

const KIYOH_TENANT_ID = 98;

const KIYOH_LOGO_URL =
  "https://mcusercontent.com/841b96d7208ddd848e8215ade/images/6aa90dcf-7d1b-4904-886c-cd9ee64d3b67.png";
const KLANTENVERTELLEN_LOGO_URL =
  "https://mcusercontent.com/841b96d7208ddd848e8215ade/images/6aa90dcf-7d1b-4904-886c-cd9ee64d3b67.png";

const TERMS_URL =
  "https://www.klantenvertellen.nl/en/terms-of-use-customer-review-system/";

const PRIVACY_POLICY_URL = "https://kiyoh.com/privacy/";

const SUPPORT_EMAIL = "marketing@kiyoh.co.za";

const KIYOH_BRAND_NAME = "Kiyoh";
const KLANTENVERTELLEN_BRAND_NAME = "Klantenvertellen";

const BANNER_IMAGE_URL =
  "https://kiyoh.com/wp-content/uploads/AdobeStock_262582377-scaled-e1599809135705.jpg";

export interface BrandConfig {
  readonly brandName: string;
  readonly logoUrl: string;
  readonly bannerImageUrl: string;
  readonly termsUrl: string;
  readonly privacyPolicyUrl: string;
  readonly supportEmail: string;
}

export function resolveBrandConfig(tenantId: number): BrandConfig {
  if (tenantId === KIYOH_TENANT_ID) {
    return {
      brandName: KIYOH_BRAND_NAME,
      logoUrl: KIYOH_LOGO_URL,
      bannerImageUrl: BANNER_IMAGE_URL,
      termsUrl: TERMS_URL,
      privacyPolicyUrl: PRIVACY_POLICY_URL,
      supportEmail: SUPPORT_EMAIL,
    };
  }

  return {
    brandName: KLANTENVERTELLEN_BRAND_NAME,
    logoUrl: KLANTENVERTELLEN_LOGO_URL,
    bannerImageUrl: BANNER_IMAGE_URL,
    termsUrl: TERMS_URL,
    privacyPolicyUrl: PRIVACY_POLICY_URL,
    supportEmail: SUPPORT_EMAIL,
  };
}
