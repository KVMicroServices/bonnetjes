export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { generateDescriptionFromCode } from "@/lib/services/failure-reason-translator";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  email: string;
  role: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CODE_PATTERN = /^[A-Z][A-Z_]*[A-Z]$/;
const MAXIMUM_CODE_LENGTH = 50;

// ─── POST: Generate an English description from a failure reason code ────────

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = (session.user as SessionUser).role === "admin";
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  if (typeof payload.code !== "string" || payload.code.length === 0) {
    return NextResponse.json({ error: "code is required and must be a non-empty string" }, { status: 400 });
  }

  if (payload.code.length > MAXIMUM_CODE_LENGTH) {
    return NextResponse.json({ error: "code must not exceed 50 characters" }, { status: 400 });
  }

  if (!CODE_PATTERN.test(payload.code)) {
    return NextResponse.json({ error: "code must contain only uppercase letters and underscores" }, { status: 400 });
  }

  try {
    const description = await generateDescriptionFromCode(payload.code);
    return NextResponse.json({ description });
  } catch (error) {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else {
      message = "Failed to generate description";
    }
    logger.error({ error, code: payload.code }, "Failed to generate description from code");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
