"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Trash2, Pencil, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MentionAutocomplete } from "@/components/mention-autocomplete";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommentAuthor {
  id: string;
  name: string | null;
  email: string;
}

interface Comment {
  id: string;
  body: string;
  authorId: string;
  receiptId: string;
  mentions: ReadonlyArray<string>;
  createdAt: string;
  updatedAt: string;
  author: CommentAuthor;
}

interface CommentThreadProps {
  receiptId: string;
  currentUserId: string;
  isAdmin: boolean;
}

interface MentionEntry {
  userId: string;
  displayName: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RELATIVE_TIME_MINUTE_MS = 60000;
const RELATIVE_TIME_HOUR_MS = 3600000;
const RELATIVE_TIME_DAY_MS = 86400000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const differenceMs = now.getTime() - date.getTime();

  if (differenceMs < RELATIVE_TIME_MINUTE_MS) {
    return "just now";
  }

  const minutes = Math.floor(differenceMs / RELATIVE_TIME_MINUTE_MS);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(differenceMs / RELATIVE_TIME_HOUR_MS);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(differenceMs / RELATIVE_TIME_DAY_MS);
  if (days < 30) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString();
}

function isCommentEdited(createdAt: string, updatedAt: string): boolean {
  const created = new Date(createdAt).getTime();
  const updated = new Date(updatedAt).getTime();
  return updated - created > 1000;
}


/**
 * Renders comment body with @-mentions highlighted.
 * Mentions in the body appear as @Name plain text.
 * We highlight any @-prefixed word that matches a known mention.
 */
function renderCommentBody(body: string, mentions: ReadonlyArray<string>): React.ReactNode {
  if (mentions.length === 0) {
    return body;
  }

  const mentionPattern = /@[\w\s]+/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match = mentionPattern.exec(body);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={match.index}
        className="rounded bg-blue-100 px-1 text-blue-700 font-medium"
      >
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
    match = mentionPattern.exec(body);
  }

  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }

  return parts;
}

// ─── Mention Input Hook ──────────────────────────────────────────────────────

function useMentionInput() {
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionVisible, setMentionVisible] = useState(false);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionStartIndexRef = useRef<number>(-1);

  const handleTextChange = useCallback((text: string, cursorPosition: number) => {
    const textBeforeCursor = text.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex === -1) {
      setMentionVisible(false);
      setMentionQuery("");
      return;
    }

    const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
    const hasSpace = textAfterAt.includes("\n");

    if (hasSpace) {
      setMentionVisible(false);
      setMentionQuery("");
      return;
    }

    if (textAfterAt.length >= 2) {
      mentionStartIndexRef.current = lastAtIndex;
      setMentionQuery(textAfterAt);
      setMentionVisible(true);
    } else {
      setMentionVisible(false);
      setMentionQuery("");
    }
  }, []);

  const handleMentionSelect = useCallback(
    (user: { id: string; name: string | null; email: string }, currentText: string) => {
      const displayName = user.name ? user.name : user.email;
      const startIndex = mentionStartIndexRef.current;
      const textarea = textareaRef.current;

      if (startIndex === -1 || !textarea) {
        return { newText: currentText, newMentions: mentions };
      }

      const beforeMention = currentText.slice(0, startIndex);
      const afterCursor = currentText.slice(textarea.selectionStart);
      const newText = `${beforeMention}@${displayName} ${afterCursor}`;

      const newMention: MentionEntry = { userId: user.id, displayName };
      const updatedMentions = [...mentions, newMention];
      setMentions(updatedMentions);
      setMentionVisible(false);
      setMentionQuery("");

      return { newText, newMentions: updatedMentions };
    },
    [mentions]
  );

  const resetMentions = useCallback(() => {
    setMentions([]);
    setMentionQuery("");
    setMentionVisible(false);
  }, []);

  return {
    mentionQuery,
    mentionVisible,
    mentions,
    setMentions,
    textareaRef,
    handleTextChange,
    handleMentionSelect,
    resetMentions,
    setMentionVisible,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommentThread({ receiptId, currentUserId, isAdmin }: CommentThreadProps) {
  const t = useTranslations("Comments");
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeText, setComposeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Compose mention state
  const composeMention = useMentionInput();

  // Edit mention state
  const editMention = useMentionInput();

  // ─── Fetch Comments ──────────────────────────────────────────────────────────

  const fetchComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/receipts/${receiptId}/comments`);
      if (response.ok) {
        const data = await response.json();
        setComments(data.comments);
      }
    } catch {
      // Silent fail — comments are non-critical
    } finally {
      setLoading(false);
    }
  }, [receiptId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // ─── Submit Comment ──────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const trimmedText = composeText.trim();
    if (!trimmedText) {
      return;
    }

    setSubmitting(true);
    try {
      const mentionIds = composeMention.mentions.map((mention) => mention.userId);
      const response = await fetch(`/api/receipts/${receiptId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmedText, mentions: mentionIds }),
      });

      if (response.ok) {
        const newComment = await response.json();
        setComments((previous) => [...previous, newComment]);
        setComposeText("");
        composeMention.resetMentions();
      }
    } catch {
      // Silent fail
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Edit Comment ────────────────────────────────────────────────────────────

  const startEditing = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditText(comment.body);
    editMention.resetMentions();
  };

  const cancelEditing = () => {
    setEditingCommentId(null);
    setEditText("");
    editMention.resetMentions();
  };

  const saveEdit = async (commentId: string) => {
    const trimmedText = editText.trim();
    if (!trimmedText) {
      return;
    }

    try {
      const mentionIds = editMention.mentions.map((mention) => mention.userId);
      const response = await fetch(`/api/receipts/${receiptId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmedText, mentions: mentionIds }),
      });

      if (response.ok) {
        const updatedComment = await response.json();
        setComments((previous) =>
          previous.map((comment) => {
            if (comment.id === commentId) {
              return updatedComment;
            }
            return comment;
          })
        );
        setEditingCommentId(null);
        setEditText("");
        editMention.resetMentions();
      }
    } catch {
      // Silent fail
    }
  };

  // ─── Delete Comment ──────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteConfirmId) {
      return;
    }

    try {
      const response = await fetch(`/api/receipts/${receiptId}/comments/${deleteConfirmId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setComments((previous) => previous.filter((comment) => comment.id !== deleteConfirmId));
      }
    } catch {
      // Silent fail
    } finally {
      setDeleteConfirmId(null);
    }
  };

  // ─── Compose Input Handlers ──────────────────────────────────────────────────

  const handleComposeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setComposeText(newValue);
    composeMention.handleTextChange(newValue, event.target.selectionStart);
  };

  const handleComposeKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.target as HTMLTextAreaElement;
    composeMention.handleTextChange(composeText, target.selectionStart);
  };

  const handleComposeMentionSelect = (user: { id: string; name: string | null; email: string }) => {
    const result = composeMention.handleMentionSelect(user, composeText);
    setComposeText(result.newText);
  };

  // ─── Edit Input Handlers ─────────────────────────────────────────────────────

  const handleEditChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setEditText(newValue);
    editMention.handleTextChange(newValue, event.target.selectionStart);
  };

  const handleEditKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.target as HTMLTextAreaElement;
    editMention.handleTextChange(editText, target.selectionStart);
  };

  const handleEditMentionSelect = (user: { id: string; name: string | null; email: string }) => {
    const result = editMention.handleMentionSelect(user, editText);
    setEditText(result.newText);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      <h4 className="text-sm font-semibold text-gray-700">{t("comments")}</h4>

      {/* Comment List */}
      <div className="flex flex-col gap-3 max-h-60 overflow-y-auto">
        {loading && (
          <p className="text-sm text-gray-500">...</p>
        )}

        {!loading && comments.length === 0 && (
          <p className="text-sm text-gray-400">{t("noComments")}</p>
        )}

        {comments.map((comment) => (
          <div key={comment.id} className="rounded-lg bg-gray-50 p-3">
            {editingCommentId === comment.id ? (
              /* Inline Edit Mode */
              <div className="flex flex-col gap-2">
                <textarea
                  ref={editMention.textareaRef}
                  value={editText}
                  onChange={handleEditChange}
                  onKeyUp={handleEditKeyUp}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                />
                <MentionAutocomplete
                  query={editMention.mentionQuery}
                  visible={editMention.mentionVisible}
                  onSelect={handleEditMentionSelect}
                  onDismiss={() => editMention.setMentionVisible(false)}
                  anchorElement={editMention.textareaRef.current}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveEdit(comment.id)}
                    disabled={!editText.trim()}
                  >
                    {t("save")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelEditing}>
                    {t("cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              /* Display Mode */
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">
                      {comment.author.name ? comment.author.name : comment.author.email}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                    {isCommentEdited(comment.createdAt, comment.updatedAt) && (
                      <span className="text-xs text-gray-400 italic">
                        ({t("edited")})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {comment.authorId === currentUserId && (
                      <button
                        type="button"
                        onClick={() => startEditing(comment)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                        title={t("edit")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(comment.authorId === currentUserId || isAdmin) && (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(comment.id)}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title={t("delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
                  {renderCommentBody(comment.body, comment.mentions)}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Compose Area */}
      <div className="relative flex flex-col gap-2">
        <textarea
          ref={composeMention.textareaRef}
          value={composeText}
          onChange={handleComposeChange}
          onKeyUp={handleComposeKeyUp}
          placeholder={t("writeComment")}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={2}
        />
        <MentionAutocomplete
          query={composeMention.mentionQuery}
          visible={composeMention.mentionVisible}
          onSelect={handleComposeMentionSelect}
          onDismiss={() => composeMention.setMentionVisible(false)}
          anchorElement={composeMention.textareaRef.current}
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!composeText.trim() || submitting}
          className="self-end"
        >
          <Send className="mr-1 h-3.5 w-3.5" />
          {t("submit")}
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirmMessage")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
