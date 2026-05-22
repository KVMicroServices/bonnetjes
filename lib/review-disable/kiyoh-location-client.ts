import { logger } from "@/lib/logger";
import { authenticateKiyohAdmin } from "./kiyoh-auth-client";

// ─── Constants ───────────────────────────────────────────────────────────────

const KIYOH_LOCATION_BASE_URL = "https://www.kiyoh.com/v1/location";
const KLANTENVERTELLEN_LOCATION_BASE_URL = "https://www.klantenvertellen.nl/v1/location";
const KIYOH_TENANT_ID = 98;
const DEFAULT_LOCALE = "en";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LocationLocaleResult {
  readonly success: boolean;
  readonly locale?: string;
  readonly error?: string;
}

interface LocationDto {
  readonly id?: string;
  readonly tenantId?: number;
  readonly locale?: string;
  readonly localeId?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLocationBaseUrl(tenantId: number): string {
  const envOverride = process.env.KIYOH_LOCATION_API_URL;
  if (envOverride) {
    return envOverride;
  }

  if (tenantId === KIYOH_TENANT_ID) {
    return KIYOH_LOCATION_BASE_URL;
  }

  return KLANTENVERTELLEN_LOCATION_BASE_URL;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetches the locale for a location from the Kiyoh/KV location API.
 * Returns the locale string (e.g. "nl", "en", "de") or falls back to
 * the default locale on any failure. Never throws.
 */
export async function resolveLocationLocale(
  locationId: string,
  tenantId: number
): Promise<LocationLocaleResult> {
  let bearerToken: string;

  try {
    const authResult = await authenticateKiyohAdmin();
    bearerToken = authResult.bearerToken;
  } catch (authError) {
    let errorMessage: string;
    if (authError instanceof Error) {
      errorMessage = authError.message;
    } else {
      errorMessage = String(authError);
    }
    logger.error(
      { locationId, tenantId, error: errorMessage },
      "Failed to authenticate with Kiyoh for location locale resolution"
    );
    return { success: false, error: `Authentication failed: ${errorMessage}` };
  }

  const baseUrl = getLocationBaseUrl(tenantId);
  const requestUrl = `${baseUrl}?id=${encodeURIComponent(locationId)}&tenantId=${encodeURIComponent(String(tenantId))}`;

  logger.info(
    { url: baseUrl, locationId, tenantId },
    "Fetching location locale from Kiyoh location API"
  );

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });
  } catch (fetchError) {
    let errorMessage: string;
    if (fetchError instanceof Error) {
      errorMessage = fetchError.message;
    } else {
      errorMessage = String(fetchError);
    }
    logger.error(
      { url: baseUrl, locationId, tenantId, error: errorMessage },
      "Kiyoh location API fetch threw an exception"
    );
    return { success: false, error: `Network error: ${errorMessage}` };
  }

  if (!response.ok) {
    let responseBody: string;
    try {
      responseBody = await response.text();
    } catch {
      responseBody = "(failed to read response body)";
    }
    logger.error(
      { status: response.status, body: responseBody, locationId, tenantId },
      "Kiyoh location API returned non-OK status"
    );
    return { success: false, error: `HTTP ${response.status}: ${responseBody}` };
  }

  let responseData: ReadonlyArray<LocationDto>;
  try {
    const parsed = await response.json();
    if (!Array.isArray(parsed)) {
      logger.warn(
        { locationId, tenantId },
        "Kiyoh location API returned non-array response"
      );
      return { success: false, error: "Unexpected response format (not an array)" };
    }
    responseData = parsed as ReadonlyArray<LocationDto>;
  } catch (parseError) {
    let errorMessage: string;
    if (parseError instanceof Error) {
      errorMessage = parseError.message;
    } else {
      errorMessage = String(parseError);
    }
    logger.error(
      { locationId, tenantId, error: errorMessage },
      "Kiyoh location API response was not valid JSON"
    );
    return { success: false, error: `Invalid JSON response: ${errorMessage}` };
  }

  if (responseData.length === 0) {
    logger.warn(
      { locationId, tenantId },
      "Kiyoh location API returned no locations"
    );
    return { success: false, error: "No locations found for the given locationId" };
  }

  const firstLocation = responseData[0];
  const locale = firstLocation.locale;

  if (!locale || locale.trim().length === 0) {
    logger.warn(
      { locationId, tenantId },
      "Kiyoh location response missing locale field"
    );
    return { success: false, error: "Location found but locale field is empty" };
  }

  logger.info(
    { locationId, tenantId, locale },
    "Successfully resolved location locale from Kiyoh API"
  );

  return { success: true, locale: locale };
}

/**
 * Resolves the locale for a location, falling back to the default locale
 * if the API call fails or returns no result. Convenience wrapper that
 * always returns a usable locale string.
 */
export async function resolveLocationLocaleWithFallback(
  locationId: string,
  tenantId: number
): Promise<string> {
  const result = await resolveLocationLocale(locationId, tenantId);
  if (result.success && result.locale) {
    return result.locale;
  }
  return DEFAULT_LOCALE;
}
