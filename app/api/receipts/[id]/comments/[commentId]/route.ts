export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { editComment, deleteComment } from "@/lib/services/comment-service";

const MAX_BODY_LENGTH = 2000;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { commentId } = await params;
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

    const userId = (session.user as any).id as string;

    const updatedComment = await editComment({
      commentId,
      userId,
      body: trimmedBody,
      mentions,
    });

    return NextResponse.json(updatedComment);
  } catch (error) {
    if (error instanceof Error && error.message === "Only the author can edit this comment") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Comment not found") {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    logger.error({ error }, "Failed to edit comment");
    return NextResponse.json(
      { error: "Failed to edit comment" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { commentId } = await params;
    const userId = (session.user as any).id as string;
    const isAdmin = (session.user as any).role === "admin";

    await deleteComment(commentId, userId, isAdmin);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message === "Only the author or an admin can delete this comment") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Comment not found") {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    logger.error({ error }, "Failed to delete comment");
    return NextResponse.json(
      { error: "Failed to delete comment" },
      { status: 500 }
    );
  }
}
