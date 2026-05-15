import { TOTP, Secret } from "otpauth";
import { logger } from "@/lib/logger";

const DEFAULT_KIYOH_AUTH_BASE_URL = "https://www.klantenvertellen.nl/v1/authentication";
const DEFAULT_KIYOH_CONTEXT_URL = "https://www.klantenvertellen.nl/v1/common/context";
const DEFAULT_TENANT_ID = 99;

function getAuthBaseUrl(): string {
  return process.env.KIYOH_AUTH_BASE_URL || DEFAULT_KIYOH_AUTH_BASE_URL;
}

function getContextUrl(): string {
  return process.env.KIYOH_CONTEXT_URL || DEFAULT_KIYOH_CONTEXT_URL;
}

function getTenantId(): number {
  const raw = parseInt(process.env.KIYOH_ADMIN_TENANT || "", 10);
  if (Number.isFinite(raw)) {
    return raw;
  }
  return DEFAULT_TENANT_ID;
}

/**
 * Token cache lifetime in milliseconds.
 * Kiyoh tokens typically last longer, but we refresh conservatively
 * to avoid using an expired token on a real API call.
 */
const TOKEN_CACHE_LIFETIME_MILLISECONDS = 25 * 60 * 1000;

interface LoginResponse {
  readonly requiresOtp: boolean;
  readonly otpSessionId: string;
  readonly hash?: string;
}

interface VerifyOtpResponse {
  readonly hash: string;
}

interface ContextResponse {
  readonly token: string;
}

export interface KiyohAuthResult {
  readonly bearerToken: string;
}

// ─── Token Cache ──────────────────────────────────────────────────────────────

interface CachedToken {
  readonly bearerToken: string;
  readonly obtainedAt: number;
}

let cachedToken: CachedToken | null = null;

function isCacheValid(): boolean {
  if (!cachedToken) {
    return false;
  }
  const elapsed = Date.now() - cachedToken.obtainedAt;
  return elapsed < TOKEN_CACHE_LIFETIME_MILLISECONDS;
}

/**
 * Clears the cached token. Call this when an API call returns 401,
 * indicating the token has expired or been invalidated.
 */
export function invalidateKiyohTokenCache(): void {
  cachedToken = null;
}

/**
 * Exchanges the login hash for the real API bearer token by calling
 * the context endpoint. The login response only returns a portal session
 * hash, which the platform's portal trades for an actual token before
 * making any review API calls.
 */
async function exchangeLoginHashForBearerToken(loginHash: string): Promise<string> {
  const contextUrl = `${getContextUrl()}?hash=${encodeURIComponent(loginHash)}`;

  logger.info({ url: getContextUrl() }, "Kiyoh context token exchange request starting");

  let contextResponse: Response;
  try {
    contextResponse = await fetch(contextUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (fetchError) {
    let errorMessage = String(fetchError);
    if (fetchError instanceof Error) {
      errorMessage = fetchError.message;
    }
    logger.error(
      { url: getContextUrl(), error: errorMessage },
      "Kiyoh context exchange fetch threw an exception"
    );
    throw new Error(`Kiyoh context exchange fetch failed: ${errorMessage}`);
  }

  const contextResponseText = await contextResponse.text();

  logger.info(
    { status: contextResponse.status, statusText: contextResponse.statusText },
    "Kiyoh context exchange response received"
  );

  if (!contextResponse.ok) {
    logger.error(
      { status: contextResponse.status, body: contextResponseText },
      "Kiyoh context exchange failed"
    );
    throw new Error(`Kiyoh context exchange failed with status ${contextResponse.status}: ${contextResponseText}`);
  }

  let contextData: ContextResponse;
  try {
    contextData = JSON.parse(contextResponseText) as ContextResponse;
  } catch {
    logger.error(
      { body: contextResponseText },
      "Kiyoh context exchange returned non-JSON response"
    );
    throw new Error(`Kiyoh context exchange returned invalid JSON: ${contextResponseText.substring(0, 200)}`);
  }

  if (!contextData.token) {
    logger.error({ contextData }, "Kiyoh context response missing token");
    throw new Error("Kiyoh context response missing bearer token");
  }

  return contextData.token;
}

/**
 * Authenticates with the Kiyoh admin API using credentials + TOTP.
 * Returns a cached token if still valid, otherwise performs a fresh login.
 *
 * 1. POST login with username/password → gets otpSessionId (or hash directly if OTP not required)
 * 2. Generate TOTP code from KIYOH_ADMIN_TOTP secret (base32) and POST verify-otp → gets login hash
 * 3. GET context?hash=<loginHash> → exchanges login hash for the real bearer token
 */
export async function authenticateKiyohAdmin(): Promise<KiyohAuthResult> {
  if (isCacheValid()) {
    return { bearerToken: cachedToken!.bearerToken };
  }

  const username = process.env.KIYOH_ADMIN_USERNAME;
  const password = process.env.KIYOH_ADMIN_PASSWORD;
  const totpSecret = process.env.KIYOH_ADMIN_TOTP;

  if (!username || !password || !totpSecret) {
    throw new Error("Missing Kiyoh admin credentials in environment variables");
  }

  const loginBody = new URLSearchParams({
    tenantId: String(getTenantId()),
    username,
    password,
  });

  const loginUrl = `${getAuthBaseUrl()}/login`;

  logger.info({ url: loginUrl, username }, "Kiyoh login request starting");

  let loginResponse: Response;
  try {
    loginResponse = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginBody.toString(),
    });
  } catch (fetchError) {
    let errorMessage = String(fetchError);
    let errorStack: string | undefined = undefined;
    if (fetchError instanceof Error) {
      errorMessage = fetchError.message;
      errorStack = fetchError.stack;
    }
    logger.error(
      { url: loginUrl, error: errorMessage, stack: errorStack },
      "Kiyoh login fetch threw an exception"
    );
    throw new Error(`Kiyoh login fetch failed: ${errorMessage}`);
  }

  const loginResponseText = await loginResponse.text();

  logger.info(
    { status: loginResponse.status, statusText: loginResponse.statusText, body: loginResponseText },
    "Kiyoh login response received"
  );

  if (!loginResponse.ok) {
    logger.error(
      { status: loginResponse.status, statusText: loginResponse.statusText, body: loginResponseText },
      "Kiyoh login request failed"
    );
    throw new Error(`Kiyoh login failed with status ${loginResponse.status}: ${loginResponseText}`);
  }

  let loginData: LoginResponse;
  try {
    loginData = JSON.parse(loginResponseText) as LoginResponse;
  } catch {
    logger.error(
      { body: loginResponseText },
      "Kiyoh login returned non-JSON response"
    );
    throw new Error(`Kiyoh login returned invalid JSON: ${loginResponseText.substring(0, 200)}`);
  }

  // If the API returned a hash directly (OTP not required for this IP), exchange it for the real token
  if (!loginData.requiresOtp && loginData.hash) {
    logger.info("Kiyoh login returned hash directly (OTP not required for this IP)");

    const bearerToken = await exchangeLoginHashForBearerToken(loginData.hash);

    cachedToken = {
      bearerToken,
      obtainedAt: Date.now(),
    };

    logger.info("Kiyoh authentication successful (no-OTP path), token cached");

    return { bearerToken };
  }

  if (!loginData.requiresOtp || !loginData.otpSessionId) {
    logger.error({ loginData }, "Kiyoh login returned unexpected response shape");
    throw new Error("Kiyoh login response missing both hash and otpSessionId");
  }

  const secret = Secret.fromBase32(totpSecret);
  const totp = new TOTP({ secret });
  const otpCode = totp.generate();

  const verifyBody = new URLSearchParams({
    otpSessionId: loginData.otpSessionId,
    otpCode,
  });

  logger.info({ url: `${getAuthBaseUrl()}/verify-otp`, otpSessionId: loginData.otpSessionId }, "Kiyoh OTP verify request starting");

  const verifyOtpUrl = `${getAuthBaseUrl()}/verify-otp`;

  let verifyResponse: Response;
  try {
    verifyResponse = await fetch(verifyOtpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyBody.toString(),
    });
  } catch (fetchError) {
    let errorMessage = String(fetchError);
    let errorStack: string | undefined = undefined;
    if (fetchError instanceof Error) {
      errorMessage = fetchError.message;
      errorStack = fetchError.stack;
    }
    logger.error(
      { url: verifyOtpUrl, error: errorMessage, stack: errorStack },
      "Kiyoh OTP verify fetch threw an exception"
    );
    throw new Error(`Kiyoh OTP verify fetch failed: ${errorMessage}`);
  }

  const verifyResponseText = await verifyResponse.text();

  logger.info(
    { status: verifyResponse.status, statusText: verifyResponse.statusText, body: verifyResponseText },
    "Kiyoh OTP verify response received"
  );

  if (!verifyResponse.ok) {
    logger.error(
      { status: verifyResponse.status, statusText: verifyResponse.statusText, body: verifyResponseText },
      "Kiyoh OTP verification failed"
    );
    throw new Error(`Kiyoh OTP verification failed with status ${verifyResponse.status}: ${verifyResponseText}`);
  }

  let verifyData: VerifyOtpResponse;
  try {
    verifyData = JSON.parse(verifyResponseText) as VerifyOtpResponse;
  } catch {
    logger.error(
      { body: verifyResponseText },
      "Kiyoh OTP verify returned non-JSON response"
    );
    throw new Error(`Kiyoh OTP verify returned invalid JSON: ${verifyResponseText.substring(0, 200)}`);
  }

  if (!verifyData.hash) {
    logger.error({ verifyData }, "Kiyoh OTP response missing hash");
    throw new Error("Kiyoh OTP response missing bearer token hash");
  }

  const bearerToken = await exchangeLoginHashForBearerToken(verifyData.hash);

  cachedToken = {
    bearerToken,
    obtainedAt: Date.now(),
  };

  logger.info("Kiyoh authentication successful, token cached");

  return { bearerToken };
}
