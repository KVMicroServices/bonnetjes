import { TOTP, Secret } from "otpauth";
import { logger } from "@/lib/logger";

const KIYOH_LOGIN_URL = "https://www.klantenvertellen.nl/v1/authentication/login";
const KIYOH_VERIFY_OTP_URL = "https://www.klantenvertellen.nl/v1/authentication/verify-otp";
const TENANT_ID = 99;

/**
 * Token cache lifetime in milliseconds.
 * Kiyoh tokens typically last longer, but we refresh conservatively
 * to avoid using an expired token on a real API call.
 */
const TOKEN_CACHE_LIFETIME_MILLISECONDS = 25 * 60 * 1000;

interface LoginResponse {
  readonly requiresOtp: boolean;
  readonly otpSessionId: string;
}

interface VerifyOtpResponse {
  readonly hash: string;
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
 * Authenticates with the Kiyoh admin API using credentials + TOTP.
 * Returns a cached token if still valid, otherwise performs a fresh login.
 *
 * 1. POST login with username/password → gets otpSessionId
 * 2. Generate TOTP code from KIYOH_ADMIN_TOTP secret (base32)
 * 3. POST verify-otp → gets hash (bearer token)
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
    tenantId: String(TENANT_ID),
    username,
    password,
  });

  logger.info({ url: KIYOH_LOGIN_URL }, "Kiyoh login request");

  const loginResponse = await fetch(KIYOH_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: loginBody.toString(),
  });

  const loginResponseText = await loginResponse.text();

  if (!loginResponse.ok) {
    logger.error({ status: loginResponse.status }, "Kiyoh login request failed");
    throw new Error(`Kiyoh login failed with status ${loginResponse.status}`);
  }

  const loginData = JSON.parse(loginResponseText) as LoginResponse;

  if (!loginData.requiresOtp || !loginData.otpSessionId) {
    logger.error({ loginData }, "Kiyoh login did not return expected OTP session");
    throw new Error("Kiyoh login response missing otpSessionId");
  }

  const secret = Secret.fromBase32(totpSecret);
  const totp = new TOTP({ secret });
  const otpCode = totp.generate();

  const verifyBody = new URLSearchParams({
    otpSessionId: loginData.otpSessionId,
    otpCode,
  });

  logger.info({ url: KIYOH_VERIFY_OTP_URL }, "Kiyoh OTP verify request");

  const verifyResponse = await fetch(KIYOH_VERIFY_OTP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyBody.toString(),
  });

  const verifyResponseText = await verifyResponse.text();

  if (!verifyResponse.ok) {
    logger.error({ status: verifyResponse.status }, "Kiyoh OTP verification failed");
    throw new Error(`Kiyoh OTP verification failed with status ${verifyResponse.status}`);
  }

  const verifyData = JSON.parse(verifyResponseText) as VerifyOtpResponse;

  if (!verifyData.hash) {
    logger.error({ verifyData }, "Kiyoh OTP response missing hash");
    throw new Error("Kiyoh OTP response missing bearer token hash");
  }

  cachedToken = {
    bearerToken: verifyData.hash,
    obtainedAt: Date.now(),
  };

  logger.info("Kiyoh authentication successful, token cached");

  return { bearerToken: verifyData.hash };
}
