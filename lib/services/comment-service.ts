import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/lib/services/notification-service";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommentWithAuthor {
  id: string;
  body: string;
  authorId: string;
  receiptId: string;
  mentions: ReadonlyArray<string>;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface CreateCommentParams {
  receiptId: string;
  authorId: string;
  body: string;
  mentions?: ReadonlyArray<string>;
}

interface EditCommentParams {
  commentId: string;
  userId: string;
  body: string;
  mentions?: ReadonlyArray<string>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_BODY_LENGTH = 2000;
const MIN_BODY_LENGTH = 1;
const MENTION_PREVIEW_LENGTH = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeMentions(mentions: ReadonlyArray<string> | undefined): string | null {
  if (!mentions) {
    return null;
  }
  if (mentions.length === 0) {
    return null;
  }
  return JSON.stringify(mentions);
}

function deserializeMentions(mentionsJson: string | null): ReadonlyArray<string> {
  if (!mentionsJson) {
    return [];
  }
  return JSON.parse(mentionsJson) as string[];
}

function validateBody(body: string): void {
  const trimmedBody = body.trim();
  if (trimmedBody.length < MIN_BODY_LENGTH) {
    throw new Error("Comment body must not be empty");
  }
  if (trimmedBody.length > MAX_BODY_LENGTH) {
    throw new Error("Comment body must not exceed 2000 characters");
  }
}

function mapCommentToCommentWithAuthor(
  comment: {
    id: string;
    body: string;
    authorId: string;
    receiptId: string;
    mentions: string | null;
    createdAt: Date;
    updatedAt: Date;
    author: { id: string; name: string | null; email: string };
  }
): CommentWithAuthor {
  return {
    id: comment.id,
    body: comment.body,
    authorId: comment.authorId,
    receiptId: comment.receiptId,
    mentions: deserializeMentions(comment.mentions),
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      id: comment.author.id,
      name: comment.author.name,
      email: comment.author.email,
    },
  };
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Creates a comment on a receipt and triggers mention notifications.
 */
export async function createComment(params: CreateCommentParams): Promise<CommentWithAuthor> {
  validateBody(params.body);

  const serializedMentions = serializeMentions(params.mentions);

  const comment = await prisma.comment.create({
    data: {
      body: params.body,
      authorId: params.authorId,
      receiptId: params.receiptId,
      mentions: serializedMentions,
    },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  const mentionsList = params.mentions;
  if (mentionsList && mentionsList.length > 0) {
    const authorName = comment.author.name;
    const displayName = authorName ? authorName : "Someone";
    const bodyPreview = params.body.slice(0, MENTION_PREVIEW_LENGTH);

    for (const mentionedUserId of mentionsList) {
      sendNotification({
        type: "comment_mention",
        title: `${displayName} mentioned you in a comment`,
        body: bodyPreview,
        metadata: {
          receiptId: params.receiptId,
          commentId: comment.id,
          mentionedUserId,
        },
      });
    }

    logger.info(
      { commentId: comment.id, mentionCount: mentionsList.length },
      "Mention notifications triggered for new comment"
    );
  }

  return mapCommentToCommentWithAuthor(comment);
}

/**
 * Returns all comments for a receipt, ordered by createdAt ascending.
 */
export async function getComments(receiptId: string): Promise<ReadonlyArray<CommentWithAuthor>> {
  const comments = await prisma.comment.findMany({
    where: { receiptId },
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  const result: CommentWithAuthor[] = [];
  for (const comment of comments) {
    result.push(mapCommentToCommentWithAuthor(comment));
  }

  return result;
}

/**
 * Edits a comment. Only the author may edit. Notifies newly mentioned users.
 */
export async function editComment(params: EditCommentParams): Promise<CommentWithAuthor> {
  validateBody(params.body);

  const existingComment = await prisma.comment.findUnique({
    where: { id: params.commentId },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!existingComment) {
    throw new Error("Comment not found");
  }

  if (existingComment.authorId !== params.userId) {
    throw new Error("Only the author can edit this comment");
  }

  const serializedMentions = serializeMentions(params.mentions);

  const updatedComment = await prisma.comment.update({
    where: { id: params.commentId },
    data: {
      body: params.body,
      mentions: serializedMentions,
    },
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  // Notify only newly added mentions
  const previousMentions = deserializeMentions(existingComment.mentions);
  const currentMentions = params.mentions;
  if (currentMentions && currentMentions.length > 0) {
    const previousMentionSet = new Set(previousMentions);
    const newlyMentionedUsers: string[] = [];

    for (const userId of currentMentions) {
      if (!previousMentionSet.has(userId)) {
        newlyMentionedUsers.push(userId);
      }
    }

    if (newlyMentionedUsers.length > 0) {
      const authorName = updatedComment.author.name;
      const displayName = authorName ? authorName : "Someone";
      const bodyPreview = params.body.slice(0, MENTION_PREVIEW_LENGTH);

      for (const mentionedUserId of newlyMentionedUsers) {
        sendNotification({
          type: "comment_mention",
          title: `${displayName} mentioned you in a comment`,
          body: bodyPreview,
          metadata: {
            receiptId: updatedComment.receiptId,
            commentId: updatedComment.id,
            mentionedUserId,
          },
        });
      }

      logger.info(
        { commentId: updatedComment.id, newMentionCount: newlyMentionedUsers.length },
        "Mention notifications triggered for edited comment"
      );
    }
  }

  return mapCommentToCommentWithAuthor(updatedComment);
}

/**
 * Deletes a comment. Only the author or an admin may delete.
 */
export async function deleteComment(
  commentId: string,
  userId: string,
  isAdmin: boolean
): Promise<void> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { authorId: true },
  });

  if (!comment) {
    throw new Error("Comment not found");
  }

  const isAuthor = comment.authorId === userId;
  if (!isAuthor && !isAdmin) {
    throw new Error("Only the author or an admin can delete this comment");
  }

  await prisma.comment.delete({
    where: { id: commentId },
  });

  logger.info(
    { commentId, deletedBy: userId, isAdmin },
    "Comment deleted"
  );
}
