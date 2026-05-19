import { describe, it, expect, beforeEach, afterEach } from "vitest";

const SECRET = "test-secret-do-not-use-in-prod";
const FALLBACK_SECRET = "fallback-secret";

describe("dispute-token", () => {
  beforeEach(() => {
    delete process.env.DISPUTE_TOKEN_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    delete process.env.DISPUTE_TOKEN_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  it("round-trips a payload with valid signature and future expiry", async () => {
    process.env.DISPUTE_TOKEN_SECRET = SECRET;
    const { signDisputeToken, verifyDisputeToken } = await import("@/lib/dispute/dispute-token");

    const token = signDisputeToken({
      reviewId: "review-1",
      tenantId: 99,
      locationId: "loc-1",
      failureReason: "NOT_A_RECEIPT",
    });

    const result = verifyDisputeToken(token);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.payload).toEqual({
        reviewId: "review-1",
        tenantId: 99,
        locationId: "loc-1",
        failureReason: "NOT_A_RECEIPT",
      });
    }
  });

  it("falls back to NEXTAUTH_SECRET when DISPUTE_TOKEN_SECRET is unset", async () => {
    process.env.NEXTAUTH_SECRET = FALLBACK_SECRET;
    const { signDisputeToken, verifyDisputeToken } = await import("@/lib/dispute/dispute-token");

    const token = signDisputeToken({
      reviewId: "review-2",
      tenantId: null,
      locationId: null,
      failureReason: null,
    });

    const result = verifyDisputeToken(token);
    expect(result.success).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    process.env.DISPUTE_TOKEN_SECRET = SECRET;
    const { signDisputeToken } = await import("@/lib/dispute/dispute-token");

    const token = signDisputeToken({
      reviewId: "review-3",
      tenantId: 99,
      locationId: "loc-3",
      failureReason: null,
    });

    process.env.DISPUTE_TOKEN_SECRET = "different-secret";
    const verifyModule = await import("@/lib/dispute/dispute-token");
    const result = verifyModule.verifyDisputeToken(token);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("invalid_signature");
    }
  });

  it("rejects an expired token", async () => {
    process.env.DISPUTE_TOKEN_SECRET = SECRET;
    const { signDisputeToken, verifyDisputeToken } = await import("@/lib/dispute/dispute-token");

    const token = signDisputeToken(
      {
        reviewId: "review-4",
        tenantId: 99,
        locationId: "loc-4",
        failureReason: "IMAGE_UNCLEAR",
      },
      { expiresInMs: -1000 }
    );

    const result = verifyDisputeToken(token);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("expired_token");
    }
  });

  it("rejects a missing token", async () => {
    process.env.DISPUTE_TOKEN_SECRET = SECRET;
    const { verifyDisputeToken } = await import("@/lib/dispute/dispute-token");

    expect(verifyDisputeToken(null).success).toBe(false);
    expect(verifyDisputeToken("").success).toBe(false);
    expect(verifyDisputeToken(undefined).success).toBe(false);
  });

  it("rejects a malformed token (wrong number of parts)", async () => {
    process.env.DISPUTE_TOKEN_SECRET = SECRET;
    const { verifyDisputeToken } = await import("@/lib/dispute/dispute-token");

    const result = verifyDisputeToken("only-one-part");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("malformed_token");
    }
  });

  it("rejects a token with garbage payload section", async () => {
    process.env.DISPUTE_TOKEN_SECRET = SECRET;
    const { verifyDisputeToken } = await import("@/lib/dispute/dispute-token");

    const result = verifyDisputeToken("notbase64.alsogarbage");
    expect(result.success).toBe(false);
  });

  it("returns missing_secret when no secret is configured", async () => {
    const { verifyDisputeToken } = await import("@/lib/dispute/dispute-token");
    const result = verifyDisputeToken("anything.anything");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("missing_secret");
    }
  });

  it("throws when signing without a configured secret", async () => {
    const { signDisputeToken } = await import("@/lib/dispute/dispute-token");

    expect(() =>
      signDisputeToken({
        reviewId: "review-5",
        tenantId: null,
        locationId: null,
        failureReason: null,
      })
    ).toThrow();
  });

  it("rejects a tampered payload (signature no longer matches)", async () => {
    process.env.DISPUTE_TOKEN_SECRET = SECRET;
    const { signDisputeToken, verifyDisputeToken } = await import("@/lib/dispute/dispute-token");

    const token = signDisputeToken({
      reviewId: "original",
      tenantId: 99,
      locationId: "loc",
      failureReason: null,
    });

    const [encodedPayload, signature] = token.split(".");
    // Decode, mutate reviewId, re-encode (without re-signing)
    const padded = encodedPayload + "=".repeat((4 - (encodedPayload.length % 4)) % 4);
    const decoded = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const json = JSON.parse(decoded);
    json.reviewId = "tampered";
    const reencoded = Buffer.from(JSON.stringify(json), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = verifyDisputeToken(`${reencoded}.${signature}`);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("invalid_signature");
    }
  });
});
