export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { createComment, getComments } from "@/lib/services/comment-service";

const MAX_BODY_LENGTH = 2000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const comments = await getComments(id);

    return NextResponse.json({ comments });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ errorMessage, error }, "Failed to fetch comments");
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const requestBody = await request.json();
    const { body, mentions } = requestBody;

    if (!body || typeof body !== "string") {
      return NextResponse.json(
        { error: "Body is required and must be a string" },
        { status: 400 }
      );
    }

    const trimmedBody = body.trim();

    if (trimmedBody.length === 0) {
      return NextResponse.json(
        { error: "Body must not be empty" },
        { status: 400 }
      );
    }

    if (trimmedBody.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: "Body must not exceed 2000 characters" },
        { status: 400 }
      );
    }

    if (mentions !== undefined && !Array.isArray(mentions)) {
      return NextResponse.json(
        { error: "Mentions must be an array" },
        { status: 400 }
      );
    }

    const authorId = (session.user as any).id as string;

    const comment = await createComment({
      receiptId: id,
      authorId,
      body: trimmedBody,
      mentions,
    });

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ errorMessage, error }, "Failed to create comment");
    return NextResponse.json(
      { error: "Failed to create comment" },
      { status: 500 }
    );
  }
}
