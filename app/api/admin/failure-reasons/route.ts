export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import {
  getAllFailureReasons,
  createFailureReason,
  updateFailureReasonDescription,
  deleteFailureReason,
  toggleFailureReasonEnabled,
} from "@/lib/services/failure-reason-service";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  email: string;
  role: string;
}

// ─── Auth Helper ─────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<{ authorized: true } | { authorized: false; response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { authorized: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const isAdmin = (session.user as SessionUser).role === "admin";
  if (!isAdmin) {
    return { authorized: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }

  return { authorized: true };
}

// ─── GET: List all failure reasons ───────────────────────────────────────────

export async function GET() {
  const authResult = await requireAdmin();
  if (!authResult.authorized) {
    return authResult.response;
  }

  try {
    const reasons = await getAllFailureReasons();
    return NextResponse.json(reasons);
  } catch (error) {
    logger.error({ error }, "Failed to fetch failure reasons");
    return NextResponse.json({ error: "Failed to fetch failure reasons" }, { status: 500 });
  }
}

// ─── POST: Create a new custom failure reason ────────────────────────────────

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.authorized) {
    return authResult.response;
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

  if (typeof payload.description !== "string" || payload.description.length === 0) {
    return NextResponse.json({ error: "description is required and must be a non-empty string" }, { status: 400 });
  }

  try {
    const created = await createFailureReason(payload.code, payload.description);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else {
      message = "Failed to create failure reason";
    }
    logger.warn({ error, code: payload.code }, "Failed to create failure reason");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// ─── PATCH: Update description or enabled status of an existing failure reason ─

export async function PATCH(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.authorized) {
    return authResult.response;
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

  // Handle enabled toggle
  if (typeof payload.enabled === "boolean") {
    try {
      const updated = await toggleFailureReasonEnabled(payload.code, payload.enabled);
      return NextResponse.json(updated);
    } catch (error) {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = "Failed to update failure reason";
      }
      logger.warn({ error, code: payload.code }, "Failed to toggle failure reason enabled status");
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // Handle description update
  if (typeof payload.description !== "string" || payload.description.length === 0) {
    return NextResponse.json({ error: "description is required and must be a non-empty string" }, { status: 400 });
  }

  try {
    const updated = await updateFailureReasonDescription(payload.code, payload.description);
    return NextResponse.json(updated);
  } catch (error) {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else {
      message = "Failed to update failure reason";
    }
    logger.warn({ error, code: payload.code }, "Failed to update failure reason");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// ─── DELETE: Delete a custom failure reason ──────────────────────────────────

export async function DELETE(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.authorized) {
    return authResult.response;
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
    await deleteFailureReason(payload.code);
    return NextResponse.json({ success: true });
  } catch (error) {
    let message: string;
    if (error instanceof Error) {
      message = error.message;
    } else {
      message = "Failed to delete failure reason";
    }
    logger.warn({ error, code: payload.code }, "Failed to delete failure reason");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
