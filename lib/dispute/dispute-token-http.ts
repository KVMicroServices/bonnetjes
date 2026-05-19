import { NextResponse } from "next/server";
import {
  verifyDisputeToken,
  type DisputeTokenError,
  type DisputeTokenPayload,
} from "@/lib/dispute/dispute-token";

export interface ResolvedDisputeToken {
  payload: DisputeTokenPayload;
}

export type ResolveDisputeTokenResult =
  | { success: true; payload: DisputeTokenPayload }
  | { success: false; response: NextResponse };

/** Resolve a dispute token from a request body. Returns either the payload or a ready-to-send error response. */
export function resolveDisputeToken(token: unknown): ResolveDisputeTokenResult {
  if (typeof token !== "string" || token.length === 0) {
    return { success: false, response: errorResponse("missing_token") };
  }

  const verification = verifyDisputeToken(token);
  if (!verification.success) {
    return { success: false, response: errorResponse(verification.error) };
  }

  return { success: true, payload: verification.payload };
}

function errorResponse(error: DisputeTokenError): NextResponse {
  if (error === "expired_token") {
    return NextResponse.json({ error: "Dispute link has expired" }, { status: 410 });
  }
  if (error === "missing_token") {
    return NextResponse.json({ error: "Missing dispute token" }, { status: 400 });
  }
  if (error === "missing_secret") {
    return NextResponse.json({ error: "Server is not configured for dispute tokens" }, { status: 500 });
  }
  return NextResponse.json({ error: "Invalid dispute token" }, { status: 401 });
}
