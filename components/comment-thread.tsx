"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Trash2, Pencil, Send, Activity } from "lucide-react";
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

interface AuditEntry {
  id: string;
  category: string;
  action: string;
  actorId: string | null;
  metadata: string | null;
  createdAt: string;
}

interface TimelineItem {
  type: "comment" | "audit";
  id: string;
  createdAt: string;
  comment?: Comment;
  audit?: AuditEntry;
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
const EDIT_THRESHOLD_MS = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(dateString: string, translations: {
  justNow: string;
  minutesAgo: (minutes: number) => string;
  hoursAgo: (hours: number) => string;
  daysAgo: (days: number) => string;
}): string {
  const date = new Date(dateString);
  const now = new Date();
  const differenceMilliseconds = now.getTime() - date.getTime();

  if (differenceMilliseconds < RELATIVE_TIME_MINUTE_MS) {
    return translations.justNow;
  }

  const minutes = Math.floor(differenceMilliseconds / RELATIVE_TIME_MINUTE_MS);
  if (minutes < 60) {
    return translations.minutesAgo(minutes);
  }

  const hours = Math.floor(differenceMilliseconds / RELATIVE_TIME_HOUR_MS);
  if (hours < 24) {
    return translations.hoursAgo(hours);
  }

  const days = Math.floor(differenceMilliseconds / RELATIVE_TIME_DAY_MS);
  if (days < 30) {
    return translations.daysAgo(days);
  }

  return date.toLocaleDateString();
}

function isCommentEdited(createdAt: string, updatedAt: string): boolean {
  const created = new Date(createdAt).getTime();
  const updated = new Date(updatedAt).getTime();
  return updated - created > EDIT_THRESHOLD_MS;
}

// ─── Audit Entry Helpers ─────────────────────────────────────────────────────

function formatAuditAction(category: string, action: string, translations: {
  aiJudgement: string;
  secondaryAnalysis: string;
  moderation: string;
  system: string;
  actionVerified: string;
  actionRejected: string;
  actionPending: string;
  actionRequiresReview: string;
  actionAutoDisableEnqueued: string;
  actionReceiptSynced: string;
  actionDisputeProcessed: string;
  actionDisableReview: string;
  actionEnableReview: string;
  actionGeneric: (action: string) => string;
}): string {
  const actionLower = action.toLowerCase();

  if (actionLower === "verified" || actionLower === "approved") {
    return translations.actionVerified;
  }
  if (actionLower === "rejected") {
    return translations.actionRejected;
  }
  if (actionLower === "pending") {
    return translations.actionPending;
  }
  if (actionLower === "requires_review") {
    return translations.actionRequiresReview;
  }
  if (actionLower === "auto_disable_enqueued") {
    return translations.actionAutoDisableEnqueued;
  }
  if (actionLower === "receipt_synced") {
    return translations.actionReceiptSynced;
  }
  if (actionLower === "dispute_processed") {
    return translations.actionDisputeProcessed;
  }
  if (actionLower === "disable_review") {
    return translations.actionDisableReview;
  }
  if (actionLower === "enable_review") {
    return translations.actionEnableReview;
  }

  return translations.actionGeneric(action);
}

function getAuditCategoryLabel(category: string, translations: {
  aiJudgement: string;
  secondaryAnalysis: string;
  moderation: string;
  system: string;
}): string {
  if (category === "ai_judgement") {
    return translations.aiJudgement;
  }
  if (category === "secondary_analysis") {
    return translations.secondaryAnalysis;
  }
  if (category === "moderation") {
    return translations.moderation;
  }
  return translations.system;
}

function mergeTimeline(comments: ReadonlyArray<Comment>, auditEntries: ReadonlyArray<AuditEntry>): ReadonlyArray<TimelineItem> {
  const items: TimelineItem[] = [];

  for (const comment of comments) {
    items.push({
      type: "comment",
      id: comment.id,
      createdAt: comment.createdAt,
      comment,
    });
  }

  for (const audit of auditEntries) {
    items.push({
      type: "audit",
      id: audit.id,
      createdAt: audit.createdAt,
      audit,
    });
  }

  items.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime();
    const dateB = new Date(b.createdAt).getTime();
    return dateA - dateB;
  });

  return items;
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
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
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

  // Translation helpers for relative time
  const relativeTimeTranslations = {
    justNow: t("justNow"),
    minutesAgo: (minutes: number) => t("minutesAgo", { count: String(minutes) }),
    hoursAgo: (hours: number) => t("hoursAgo", { count: String(hours) }),
    daysAgo: (days: number) => t("daysAgo", { count: String(days) }),
  };

  // Translation helpers for audit entries
  const auditActionTranslations = {
    aiJudgement: t("auditCategoryAiJudgement"),
    secondaryAnalysis: t("auditCategorySecondaryAnalysis"),
    moderation: t("auditCategoryModeration"),
    system: t("auditCategorySystem"),
    actionVerified: t("auditActionVerified"),
    actionRejected: t("auditActionRejected"),
    actionPending: t("auditActionPending"),
    actionRequiresReview: t("auditActionRequiresReview"),
    actionAutoDisableEnqueued: t("auditActionAutoDisableEnqueued"),
    actionReceiptSynced: t("auditActionReceiptSynced"),
    actionDisputeProcessed: t("auditActionDisputeProcessed"),
    actionDisableReview: t("auditActionDisableReview"),
    actionEnableReview: t("auditActionEnableReview"),
    actionGeneric: (action: string) => t("auditActionGeneric", { action }),
  };

  const auditCategoryTranslations = {
    aiJudgement: t("auditCategoryAiJudgement"),
    secondaryAnalysis: t("auditCategorySecondaryAnalysis"),
    moderation: t("auditCategoryModeration"),
    system: t("auditCategorySystem"),
  };

  // ─── Fetch Comments and Activity ─────────────────────────────────────────────

  const fetchComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/receipts/${receiptId}/comments`);
      if (response.ok) {
        const data = await response.json();
        setComments(data.comments);
      }
    } catch {
      // Silent fail — comments are non-critical
    }
  }, [receiptId]);

  const fetchActivity = useCallback(async () => {
    try {
      const response = await fetch(`/api/receipts/${receiptId}/activity`);
      if (response.ok) {
        const data = await response.json();
        setAuditEntries(data.entries);
      }
    } catch {
      // Silent fail — activity log is non-critical
    }
  }, [receiptId]);

  useEffect(() => {
    async function loadAll() {
      await Promise.all([fetchComments(), fetchActivity()]);
      setLoading(false);
    }
    loadAll();
  }, [fetchComments, fetchActivity]);

  // Build merged timeline
  const timeline = mergeTimeline(comments, auditEntries);

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
      <h4 className="text-sm font-semibold text-gray-700">{t("activityLog")}</h4>

      {/* Timeline List */}
      <div className="flex flex-col gap-3 max-h-72 overflow-y-auto">
        {loading && (
          <p className="text-sm text-gray-500">...</p>
        )}

        {!loading && timeline.length === 0 && (
          <p className="text-sm text-gray-400">{t("noActivity")}</p>
        )}

        {timeline.map((item) => {
          if (item.type === "audit" && item.audit) {
            return (
              <div key={`audit-${item.id}`} className="flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <Activity className="mt-0.5 h-3.5 w-3.5 text-slate-400 shrink-0" />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-600">
                      {getAuditCategoryLabel(item.audit.category, auditCategoryTranslations)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatAuditAction(item.audit.category, item.audit.action, auditActionTranslations)}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {formatRelativeTime(item.createdAt, relativeTimeTranslations)}
                  </span>
                </div>
              </div>
            );
          }

          if (item.type === "comment" && item.comment) {
            const comment = item.comment;
            return (
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
                          {(() => {
                            if (comment.author.name) {
                              return comment.author.name;
                            }
                            return comment.author.email;
                          })()}
                        </span>
                        <span className="text-xs text-gray-400">
                          {formatRelativeTime(comment.createdAt, relativeTimeTranslations)}
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
            );
          }

          return null;
        })}
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
