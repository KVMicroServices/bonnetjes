import { TOTP } from "otpauth";
import { logger } from "@/lib/logger";

const KIYOH_LOGIN_URL = "https://www.klantenvertellen.nl/v1/authentication/login";
const KIYOH_VERIFY_OTP_URL = "https://www.klantenvertellen.nl/v1/authentication/verify-otp";
const TENANT_ID = 99;

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

/**
 * Authenticates with the Kiyoh admin API using credentials + TOTP.
 * 1. POST login with username/password → gets otpSessionId
 * 2. Generate TOTP code from KIYOH_ADMIN_TOTP secret
 * 3. POST verify-otp → gets hash (bearer token)
 */
export async function authenticateKiyohAdmin(): Promise<KiyohAuthResult> {
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

  logger.info(
    { url: KIYOH_LOGIN_URL, body: loginBody.toString() },
    "Kiyoh login request"
  );

  const loginResponse = await fetch(KIYOH_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: loginBody.toString(),
  });

  const loginResponseText = await loginResponse.text();

  logger.info(
    { status: loginResponse.status, body: loginResponseText },
    "Kiyoh login response"
  );

  if (!loginResponse.ok) {
    logger.error({ status: loginResponse.status, body: loginResponseText }, "Kiyoh login request failed");
    throw new Error(`Kiyoh login failed with status ${loginResponse.status}`);
  }

  const loginData = JSON.parse(loginResponseText) as LoginResponse;

  if (!loginData.requiresOtp || !loginData.otpSessionId) {
    logger.error({ loginData }, "Kiyoh login did not return expected OTP session");
    throw new Error("Kiyoh login response missing otpSessionId");
  }

  const totp = new TOTP({ secret: totpSecret });
  const otpCode = totp.generate();

  const verifyBody = new URLSearchParams({
    otpSessionId: loginData.otpSessionId,
    otpCode,
  });

  logger.info(
    { url: KIYOH_VERIFY_OTP_URL, body: verifyBody.toString() },
    "Kiyoh OTP verify request"
  );

  const verifyResponse = await fetch(KIYOH_VERIFY_OTP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyBody.toString(),
  });

  const verifyResponseText = await verifyResponse.text();

  logger.info(
    { status: verifyResponse.status, body: verifyResponseText },
    "Kiyoh OTP verify response"
  );

  if (!verifyResponse.ok) {
    logger.error({ status: verifyResponse.status, body: verifyResponseText }, "Kiyoh OTP verification failed");
    throw new Error(`Kiyoh OTP verification failed with status ${verifyResponse.status}`);
  }

  const verifyData = JSON.parse(verifyResponseText) as VerifyOtpResponse;

  if (!verifyData.hash) {
    logger.error({ verifyData }, "Kiyoh OTP response missing hash");
    throw new Error("Kiyoh OTP response missing bearer token hash");
  }

  return { bearerToken: verifyData.hash };
}
