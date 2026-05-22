export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { generateDescriptionFromCode } from "@/lib/services/failure-reason-translator";

// ─── POST: Generate an English description from a failure reason code ────────

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = (session.user as any).role === "admin";
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

  try {
    const description = await generateDescriptionFromCode(payload.code);
    return NextResponse.json({ description });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate description";
    logger.error({ error, code: payload.code }, "Failed to generate description from code");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
