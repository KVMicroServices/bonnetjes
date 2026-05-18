import { createHmac, timingSafeEqual } from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOKEN_VERSION = 1;
const DEFAULT_EXPIRY_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const HMAC_ALGORITHM = "sha256";
const TOKEN_SEPARATOR = ".";
const DISPUTE_TOKEN_SECRET_VAR = "DISPUTE_TOKEN_SECRET";
const FALLBACK_SECRET_VAR = "NEXTAUTH_SECRET";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DisputeTokenPayload {
  readonly reviewId: string;
  readonly tenantId: number | null;
  readonly locationId: string | null;
  readonly failureReason: string | null;
}

interface SignedPayload extends DisputeTokenPayload {
  readonly v: number;
  readonly exp: number;
}

export type DisputeTokenResult =
  | { readonly success: true; readonly payload: DisputeTokenPayload }
  | { readonly success: false; readonly error: DisputeTokenError };

export type DisputeTokenError =
  | "missing_token"
  | "malformed_token"
  | "invalid_signature"
  | "expired_token"
  | "missing_secret";

// ─── Public API ──────────────────────────────────────────────────────────────

/** Sign a dispute payload into an opaque base64url token. */
export function signDisputeToken(
  payload: DisputeTokenPayload,
  options?: { readonly expiresInMs?: number }
): string {
  const secret = readSecret();
  if (!secret) {
    throw new Error(
      `Cannot sign dispute token: set ${DISPUTE_TOKEN_SECRET_VAR} or ${FALLBACK_SECRET_VAR}`
    );
  }

  let expiresInMs = DEFAULT_EXPIRY_DAYS * MILLISECONDS_PER_DAY;
  if (options?.expiresInMs !== undefined) {
    expiresInMs = options.expiresInMs;
  }

  const signedPayload: SignedPayload = {
    v: TOKEN_VERSION,
    exp: Date.now() + expiresInMs,
    reviewId: payload.reviewId,
    tenantId: payload.tenantId,
    locationId: payload.locationId,
    failureReason: payload.failureReason,
  };

  const encodedPayload = encodeBase64Url(Buffer.from(JSON.stringify(signedPayload), "utf8"));
  const signature = computeSignature(encodedPayload, secret);

  return `${encodedPayload}${TOKEN_SEPARATOR}${signature}`;
}

/** Verify a dispute token and return the payload, or an error code. */
export function verifyDisputeToken(token: string | null | undefined): DisputeTokenResult {
  if (!token || token.length === 0) {
    return { success: false, error: "missing_token" };
  }

  const secret = readSecret();
  if (!secret) {
    return { success: false, error: "missing_secret" };
  }

  const parts = token.split(TOKEN_SEPARATOR);
  if (parts.length !== 2) {
    return { success: false, error: "malformed_token" };
  }

  const [encodedPayload, providedSignature] = parts;

  const expectedSignature = computeSignature(encodedPayload, secret);
  if (!constantTimeEquals(providedSignature, expectedSignature)) {
    return { success: false, error: "invalid_signature" };
  }

  let signedPayload: SignedPayload;
  try {
    const decoded = decodeBase64Url(encodedPayload);
    signedPayload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return { success: false, error: "malformed_token" };
  }

  if (typeof signedPayload.exp !== "number" || signedPayload.exp < Date.now()) {
    return { success: false, error: "expired_token" };
  }

  if (typeof signedPayload.reviewId !== "string" || signedPayload.reviewId.length === 0) {
    return { success: false, error: "malformed_token" };
  }

  let tenantId: number | null = null;
  if (typeof signedPayload.tenantId === "number") {
    tenantId = signedPayload.tenantId;
  }

  let locationId: string | null = null;
  if (typeof signedPayload.locationId === "string" && signedPayload.locationId.length > 0) {
    locationId = signedPayload.locationId;
  }

  let failureReason: string | null = null;
  if (typeof signedPayload.failureReason === "string" && signedPayload.failureReason.length > 0) {
    failureReason = signedPayload.failureReason;
  }

  return {
    success: true,
    payload: {
      reviewId: signedPayload.reviewId,
      tenantId,
      locationId,
      failureReason,
    },
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function readSecret(): string | null {
  const primary = process.env[DISPUTE_TOKEN_SECRET_VAR];
  if (primary && primary.length > 0) {
    return primary;
  }

  const fallback = process.env[FALLBACK_SECRET_VAR];
  if (fallback && fallback.length > 0) {
    return fallback;
  }

  return null;
}

function computeSignature(encodedPayload: string, secret: string): string {
  const hmac = createHmac(HMAC_ALGORITHM, secret);
  hmac.update(encodedPayload);
  return encodeBase64Url(hmac.digest());
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function encodeBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(input: string): Buffer {
  let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) {
    normalized += "=";
  }
  return Buffer.from(normalized, "base64");
}
