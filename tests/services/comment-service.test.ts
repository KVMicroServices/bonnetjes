import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupPrismaMock, MockPrismaClient } from "../helpers/mock-prisma";

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

const mockSendNotification = vi.fn();

vi.mock("@/lib/services/notification-service", () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

const mockPrisma: MockPrismaClient = setupPrismaMock();

// ─── Import After Mocks ─────────────────────────────────────────────────────

import {
  createComment,
  getComments,
  editComment,
  deleteComment,
} from "@/lib/services/comment-service";

// ─── Constants ───────────────────────────────────────────────────────────────

const AUTHOR_ID = "user-author-001";
const OTHER_USER_ID = "user-other-002";
const ADMIN_USER_ID = "user-admin-003";
const RECEIPT_ID = "receipt-001";
const COMMENT_ID = "comment-001";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function createCommentRecord(overrides: Partial<{
  id: string;
  body: string;
  authorId: string;
  receiptId: string;
  mentions: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string | null; email: string };
}> = {}) {
  return {
    id: overrides.id || COMMENT_ID,
    body: overrides.body || "This is a test comment",
    authorId: overrides.authorId || AUTHOR_ID,
    receiptId: overrides.receiptId || RECEIPT_ID,
    mentions: overrides.mentions !== undefined ? overrides.mentions : null,
    createdAt: overrides.createdAt || new Date("2024-06-01T10:00:00Z"),
    updatedAt: overrides.updatedAt || new Date("2024-06-01T10:00:00Z"),
    author: overrides.author || {
      id: AUTHOR_ID,
      name: "Test Author",
      email: "author@example.com",
    },
  };
}


// ─── Tests: createComment ────────────────────────────────────────────────────

describe("createComment", () => {
  beforeEach(() => {
    mockSendNotification.mockClear();
  });

  it("creates a comment and returns it with author details", async () => {
    const record = createCommentRecord();
    mockPrisma.comment.create.mockResolvedValue(record as any);

    const result = await createComment({
      receiptId: RECEIPT_ID,
      authorId: AUTHOR_ID,
      body: "This is a test comment",
    });

    expect(result.id).toBe(COMMENT_ID);
    expect(result.body).toBe("This is a test comment");
    expect(result.author.name).toBe("Test Author");
    expect(result.mentions).toEqual([]);
    expect(mockPrisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "This is a test comment",
          authorId: AUTHOR_ID,
          receiptId: RECEIPT_ID,
        }),
      })
    );
  });

  it("throws when body is empty", async () => {
    await expect(
      createComment({
        receiptId: RECEIPT_ID,
        authorId: AUTHOR_ID,
        body: "",
      })
    ).rejects.toThrow("Comment body must not be empty");
  });

  it("throws when body is only whitespace", async () => {
    await expect(
      createComment({
        receiptId: RECEIPT_ID,
        authorId: AUTHOR_ID,
        body: "   ",
      })
    ).rejects.toThrow("Comment body must not be empty");
  });

  it("throws when body exceeds 2000 characters", async () => {
    const longBody = "a".repeat(2001);

    await expect(
      createComment({
        receiptId: RECEIPT_ID,
        authorId: AUTHOR_ID,
        body: longBody,
      })
    ).rejects.toThrow("Comment body must not exceed 2000 characters");
  });

  it("triggers mention notifications for each mentioned user", async () => {
    const mentionedUsers = ["user-mentioned-1", "user-mentioned-2"];
    const record = createCommentRecord({
      mentions: JSON.stringify(mentionedUsers),
    });
    mockPrisma.comment.create.mockResolvedValue(record as any);

    await createComment({
      receiptId: RECEIPT_ID,
      authorId: AUTHOR_ID,
      body: "Hey @User1 and @User2",
      mentions: mentionedUsers,
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "comment_mention",
        metadata: expect.objectContaining({
          mentionedUserId: "user-mentioned-1",
          receiptId: RECEIPT_ID,
        }),
      })
    );
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "comment_mention",
        metadata: expect.objectContaining({
          mentionedUserId: "user-mentioned-2",
          receiptId: RECEIPT_ID,
        }),
      })
    );
  });

  it("does not trigger notifications when no mentions provided", async () => {
    const record = createCommentRecord();
    mockPrisma.comment.create.mockResolvedValue(record as any);

    await createComment({
      receiptId: RECEIPT_ID,
      authorId: AUTHOR_ID,
      body: "No mentions here",
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});


// ─── Tests: editComment ──────────────────────────────────────────────────────

describe("editComment", () => {
  beforeEach(() => {
    mockSendNotification.mockClear();
  });

  it("allows the author to edit their comment", async () => {
    const existingRecord = createCommentRecord();
    const updatedRecord = createCommentRecord({
      body: "Updated comment body",
      updatedAt: new Date("2024-06-01T11:00:00Z"),
    });

    mockPrisma.comment.findUnique.mockResolvedValue(existingRecord as any);
    mockPrisma.comment.update.mockResolvedValue(updatedRecord as any);

    const result = await editComment({
      commentId: COMMENT_ID,
      userId: AUTHOR_ID,
      body: "Updated comment body",
    });

    expect(result.body).toBe("Updated comment body");
    expect(mockPrisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMMENT_ID },
        data: expect.objectContaining({
          body: "Updated comment body",
        }),
      })
    );
  });

  it("throws when a non-author tries to edit", async () => {
    const existingRecord = createCommentRecord({ authorId: AUTHOR_ID });
    mockPrisma.comment.findUnique.mockResolvedValue(existingRecord as any);

    await expect(
      editComment({
        commentId: COMMENT_ID,
        userId: OTHER_USER_ID,
        body: "Trying to edit",
      })
    ).rejects.toThrow("Only the author can edit this comment");
  });

  it("throws when comment is not found", async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null);

    await expect(
      editComment({
        commentId: "nonexistent",
        userId: AUTHOR_ID,
        body: "Trying to edit",
      })
    ).rejects.toThrow("Comment not found");
  });

  it("validates body on edit — rejects empty body", async () => {
    await expect(
      editComment({
        commentId: COMMENT_ID,
        userId: AUTHOR_ID,
        body: "",
      })
    ).rejects.toThrow("Comment body must not be empty");
  });

  it("validates body on edit — rejects body exceeding 2000 characters", async () => {
    const longBody = "b".repeat(2001);

    await expect(
      editComment({
        commentId: COMMENT_ID,
        userId: AUTHOR_ID,
        body: longBody,
      })
    ).rejects.toThrow("Comment body must not exceed 2000 characters");
  });

  it("triggers notifications only for newly added mentions", async () => {
    const existingMentions = ["user-existing-1"];
    const newMentions = ["user-existing-1", "user-new-2", "user-new-3"];

    const existingRecord = createCommentRecord({
      mentions: JSON.stringify(existingMentions),
    });
    const updatedRecord = createCommentRecord({
      body: "Updated with @User2 and @User3",
      mentions: JSON.stringify(newMentions),
    });

    mockPrisma.comment.findUnique.mockResolvedValue(existingRecord as any);
    mockPrisma.comment.update.mockResolvedValue(updatedRecord as any);

    await editComment({
      commentId: COMMENT_ID,
      userId: AUTHOR_ID,
      body: "Updated with @User2 and @User3",
      mentions: newMentions,
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          mentionedUserId: "user-new-2",
        }),
      })
    );
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          mentionedUserId: "user-new-3",
        }),
      })
    );
  });

  it("does not trigger notifications when mentions are unchanged", async () => {
    const existingMentions = ["user-existing-1"];

    const existingRecord = createCommentRecord({
      mentions: JSON.stringify(existingMentions),
    });
    const updatedRecord = createCommentRecord({
      body: "Updated body same mentions",
      mentions: JSON.stringify(existingMentions),
    });

    mockPrisma.comment.findUnique.mockResolvedValue(existingRecord as any);
    mockPrisma.comment.update.mockResolvedValue(updatedRecord as any);

    await editComment({
      commentId: COMMENT_ID,
      userId: AUTHOR_ID,
      body: "Updated body same mentions",
      mentions: existingMentions,
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});


// ─── Tests: deleteComment ────────────────────────────────────────────────────

describe("deleteComment", () => {
  it("allows the author to delete their own comment", async () => {
    const record = { authorId: AUTHOR_ID };
    mockPrisma.comment.findUnique.mockResolvedValue(record as any);
    mockPrisma.comment.delete.mockResolvedValue({} as any);

    await deleteComment(COMMENT_ID, AUTHOR_ID, false);

    expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
      where: { id: COMMENT_ID },
    });
  });

  it("allows an admin to delete any comment", async () => {
    const record = { authorId: AUTHOR_ID };
    mockPrisma.comment.findUnique.mockResolvedValue(record as any);
    mockPrisma.comment.delete.mockResolvedValue({} as any);

    await deleteComment(COMMENT_ID, ADMIN_USER_ID, true);

    expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
      where: { id: COMMENT_ID },
    });
  });

  it("throws when a non-author non-admin tries to delete", async () => {
    const record = { authorId: AUTHOR_ID };
    mockPrisma.comment.findUnique.mockResolvedValue(record as any);

    await expect(
      deleteComment(COMMENT_ID, OTHER_USER_ID, false)
    ).rejects.toThrow("Only the author or an admin can delete this comment");
  });

  it("throws when comment is not found", async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null);

    await expect(
      deleteComment("nonexistent", AUTHOR_ID, false)
    ).rejects.toThrow("Comment not found");
  });
});


// ─── Tests: getComments ──────────────────────────────────────────────────────

describe("getComments", () => {
  it("returns comments ordered by createdAt ascending", async () => {
    const firstComment = createCommentRecord({
      id: "comment-first",
      createdAt: new Date("2024-06-01T08:00:00Z"),
    });
    const secondComment = createCommentRecord({
      id: "comment-second",
      createdAt: new Date("2024-06-01T09:00:00Z"),
    });

    mockPrisma.comment.findMany.mockResolvedValue([firstComment, secondComment] as any);

    const result = await getComments(RECEIPT_ID);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("comment-first");
    expect(result[1].id).toBe("comment-second");
    expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { receiptId: RECEIPT_ID },
        orderBy: { createdAt: "asc" },
      })
    );
  });

  it("includes author details in each comment", async () => {
    const record = createCommentRecord({
      author: {
        id: AUTHOR_ID,
        name: "Jane Doe",
        email: "jane@example.com",
      },
    });
    mockPrisma.comment.findMany.mockResolvedValue([record] as any);

    const result = await getComments(RECEIPT_ID);

    expect(result[0].author.id).toBe(AUTHOR_ID);
    expect(result[0].author.name).toBe("Jane Doe");
    expect(result[0].author.email).toBe("jane@example.com");
  });

  it("deserializes mentions JSON into an array", async () => {
    const mentionIds = ["user-1", "user-2"];
    const record = createCommentRecord({
      mentions: JSON.stringify(mentionIds),
    });
    mockPrisma.comment.findMany.mockResolvedValue([record] as any);

    const result = await getComments(RECEIPT_ID);

    expect(result[0].mentions).toEqual(["user-1", "user-2"]);
  });

  it("returns empty array for mentions when mentions field is null", async () => {
    const record = createCommentRecord({ mentions: null });
    mockPrisma.comment.findMany.mockResolvedValue([record] as any);

    const result = await getComments(RECEIPT_ID);

    expect(result[0].mentions).toEqual([]);
  });

  it("returns empty array when no comments exist for the receipt", async () => {
    mockPrisma.comment.findMany.mockResolvedValue([]);

    const result = await getComments(RECEIPT_ID);

    expect(result).toEqual([]);
  });
});
