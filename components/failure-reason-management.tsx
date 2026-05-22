"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Sparkles, Save } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FailureReasonDefinition {
  code: string;
  description: string;
  isBuiltIn: boolean;
  enabled: boolean;
  nl: string | null;
  de: string | null;
  fr: string | null;
  es: string | null;
  af: string | null;
  xh: string | null;
  zu: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CODE_PATTERN = /^[A-Z][A-Z_]*[A-Z]$/;
const MINIMUM_CODE_LENGTH = 2;
const MAXIMUM_CODE_LENGTH = 50;
const MAXIMUM_DESCRIPTION_LENGTH = 500;

// ─── Component ───────────────────────────────────────────────────────────────

export function FailureReasonManagement() {
  const { toast } = useToast();
  const t = useTranslations("Settings");

  const [reasons, setReasons] = useState<FailureReasonDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState<string | null>(null);
  const [togglingCode, setTogglingCode] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);

  // Inline editing state
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState("");

  // New reason form state
  const [newCode, setNewCode] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creatingReason, setCreatingReason] = useState(false);
  const [generatingNewDescription, setGeneratingNewDescription] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchReasons = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/failure-reasons");
      if (response.ok) {
        const data = await response.json();
        setReasons(data);
      }
    } catch {
      toast({
        title: t("failureReasonLoadFailed"),
        description: t("failureReasonLoadFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    fetchReasons();
  }, [fetchReasons]);

  // ─── Validation ────────────────────────────────────────────────────────────

  function validateCode(code: string): string | null {
    if (!code || code.length < MINIMUM_CODE_LENGTH) {
      return t("failureReasonCodeTooShort");
    }
    if (code.length > MAXIMUM_CODE_LENGTH) {
      return t("failureReasonCodeTooLong");
    }
    if (!CODE_PATTERN.test(code)) {
      return t("failureReasonCodeInvalid");
    }
    return null;
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleCodeChange = (value: string) => {
    const uppercased = value.toUpperCase().replace(/[^A-Z_]/g, "");
    setNewCode(uppercased);
    if (uppercased.length > 0) {
      setCodeError(validateCode(uppercased));
    } else {
      setCodeError(null);
    }
  };

  const handleCreate = async () => {
    const validationError = validateCode(newCode);
    if (validationError) {
      setCodeError(validationError);
      return;
    }
    if (!newDescription.trim()) {
      toast({
        title: t("failureReasonDescriptionRequired"),
        variant: "destructive",
      });
      return;
    }

    setCreatingReason(true);
    try {
      const response = await fetch("/api/admin/failure-reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode, description: newDescription.trim() }),
      });

      if (response.ok) {
        const created = await response.json();
        setReasons((previous) => [...previous, created]);
        setNewCode("");
        setNewDescription("");
        setCodeError(null);
        toast({
          title: t("failureReasonCreated"),
          description: t("failureReasonCreatedDescription"),
        });
      } else {
        const errorData = await response.json();
        toast({
          title: t("failureReasonCreateFailed"),
          description: errorData.error || t("failureReasonCreateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("failureReasonCreateFailed"),
        description: t("failureReasonCreateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setCreatingReason(false);
    }
  };

  const handleSaveDescription = async (code: string) => {
    const trimmed = editingDescription.trim();
    if (!trimmed) {
      return;
    }

    setSavingCode(code);
    try {
      const response = await fetch("/api/admin/failure-reasons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, description: trimmed }),
      });

      if (response.ok) {
        const updated = await response.json();
        setReasons((previous) =>
          previous.map((reason) => {
            if (reason.code === code) {
              return updated;
            }
            return reason;
          })
        );
        setEditingCode(null);
        setEditingDescription("");
        toast({
          title: t("failureReasonSaved"),
          description: t("failureReasonSavedDescription"),
        });
      } else {
        const errorData = await response.json();
        toast({
          title: t("failureReasonSaveFailed"),
          description: errorData.error || t("failureReasonSaveFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("failureReasonSaveFailed"),
        description: t("failureReasonSaveFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setSavingCode(null);
    }
  };

  const handleGenerate = async (code: string, isNewForm: boolean) => {
    if (isNewForm) {
      setGeneratingNewDescription(true);
    } else {
      setGeneratingCode(code);
    }

    try {
      const response = await fetch("/api/admin/failure-reasons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (response.ok) {
        const data = await response.json();
        if (isNewForm) {
          setNewDescription(data.description);
        } else {
          setEditingDescription(data.description);
        }
      } else {
        toast({
          title: t("failureReasonGenerateFailed"),
          description: t("failureReasonGenerateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("failureReasonGenerateFailed"),
        description: t("failureReasonGenerateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      if (isNewForm) {
        setGeneratingNewDescription(false);
      } else {
        setGeneratingCode(null);
      }
    }
  };

  const handleToggleEnabled = async (code: string, currentEnabled: boolean) => {
    setTogglingCode(code);

    // Optimistic update
    setReasons((previous) =>
      previous.map((reason) => {
        if (reason.code === code) {
          return { ...reason, enabled: !currentEnabled };
        }
        return reason;
      })
    );

    try {
      const response = await fetch("/api/admin/failure-reasons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, enabled: !currentEnabled }),
      });

      if (!response.ok) {
        // Revert optimistic update
        setReasons((previous) =>
          previous.map((reason) => {
            if (reason.code === code) {
              return { ...reason, enabled: currentEnabled };
            }
            return reason;
          })
        );
        toast({
          title: t("failureReasonToggleFailed"),
          description: t("failureReasonToggleFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      // Revert optimistic update
      setReasons((previous) =>
        previous.map((reason) => {
          if (reason.code === code) {
            return { ...reason, enabled: currentEnabled };
          }
          return reason;
        })
      );
      toast({
        title: t("failureReasonToggleFailed"),
        description: t("failureReasonToggleFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setTogglingCode(null);
    }
  };

  const handleDelete = async (code: string) => {
    setDeletingCode(code);
    try {
      const response = await fetch("/api/admin/failure-reasons", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (response.ok) {
        setReasons((previous) => previous.filter((reason) => reason.code !== code));
        toast({
          title: t("failureReasonDeleted"),
          description: t("failureReasonDeletedDescription"),
        });
      } else {
        const errorData = await response.json();
        toast({
          title: t("failureReasonDeleteFailed"),
          description: errorData.error || t("failureReasonDeleteFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("failureReasonDeleteFailed"),
        description: t("failureReasonDeleteFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setDeletingCode(null);
      setDeleteTarget(null);
    }
  };

  const startEditing = (reason: FailureReasonDefinition) => {
    setEditingCode(reason.code);
    setEditingDescription(reason.description);
  };

  const cancelEditing = () => {
    setEditingCode(null);
    setEditingDescription("");
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-kv-green" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reason List */}
      <div className="space-y-3">
        {reasons.map((reason) => {
          const isTranslating = savingCode === reason.code;
          const isEditing = editingCode === reason.code;
          const isGenerating = generatingCode === reason.code;

          return (
            <div
              key={reason.code}
              className={`rounded-lg border border-gray-200 p-4 transition-opacity ${isTranslating ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-gray-900">
                      {reason.code}
                    </span>
                    {reason.isBuiltIn && (
                      <Badge variant="secondary" className="text-xs">
                        {t("failureReasonBuiltIn")}
                      </Badge>
                    )}
                    {isTranslating && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("failureReasonTranslating")}
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editingDescription}
                        onChange={(event) => setEditingDescription(event.target.value)}
                        maxLength={MAXIMUM_DESCRIPTION_LENGTH}
                        rows={2}
                        disabled={isTranslating}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 disabled:opacity-50"
                        aria-label={t("failureReasonDescriptionLabel")}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveDescription(reason.code)}
                          disabled={isTranslating || !editingDescription.trim()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-kv-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
                        >
                          {isTranslating ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Save className="h-3 w-3" />
                          )}
                          {t("failureReasonSaveButton")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerate(reason.code, false)}
                          disabled={isGenerating || isTranslating}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                        >
                          {isGenerating ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          {t("failureReasonGenerateButton")}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          disabled={isTranslating}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
                        >
                          {t("failureReasonCancelButton")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p
                      className="cursor-pointer text-sm text-gray-600 hover:text-gray-900"
                      onClick={() => startEditing(reason)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          startEditing(reason);
                        }
                      }}
                      aria-label={t("failureReasonEditDescription")}
                    >
                      {reason.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={reason.enabled}
                    onCheckedChange={() => handleToggleEnabled(reason.code, reason.enabled)}
                    disabled={togglingCode === reason.code || isTranslating}
                    aria-label={t("failureReasonToggleLabel", { code: reason.code })}
                  />
                  {!reason.isBuiltIn && (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(reason.code)}
                      disabled={isTranslating || deletingCode === reason.code}
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      aria-label={t("failureReasonDeleteButton", { code: reason.code })}
                    >
                      {deletingCode === reason.code ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* New Reason Form */}
      <div className="rounded-lg border border-dashed border-gray-300 p-4">
        <p className="mb-3 text-sm font-medium text-gray-900">
          {t("failureReasonNewTitle")}
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="new-reason-code" className="mb-1 block text-xs font-medium text-gray-700">
              {t("failureReasonCodeLabel")}
            </label>
            <input
              id="new-reason-code"
              type="text"
              value={newCode}
              onChange={(event) => handleCodeChange(event.target.value)}
              maxLength={MAXIMUM_CODE_LENGTH}
              placeholder={t("failureReasonCodePlaceholder")}
              disabled={creatingReason}
              className={`w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm text-gray-700 placeholder:text-gray-400 disabled:opacity-50 ${
                codeError ? "border-red-300" : "border-gray-200"
              }`}
              aria-label={t("failureReasonCodeLabel")}
              aria-invalid={codeError ? "true" : "false"}
            />
            {codeError && (
              <p className="mt-1 text-xs text-red-600">{codeError}</p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="new-reason-description" className="block text-xs font-medium text-gray-700">
                {t("failureReasonDescriptionLabel")}
              </label>
              <button
                type="button"
                onClick={() => handleGenerate(newCode, true)}
                disabled={generatingNewDescription || !newCode || !!validateCode(newCode)}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-50"
              >
                {generatingNewDescription ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {t("failureReasonGenerateButton")}
              </button>
            </div>
            <textarea
              id="new-reason-description"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              maxLength={MAXIMUM_DESCRIPTION_LENGTH}
              placeholder={t("failureReasonDescriptionPlaceholder")}
              rows={2}
              disabled={creatingReason}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 disabled:opacity-50"
              aria-label={t("failureReasonDescriptionLabel")}
            />
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={creatingReason || !newCode || !newDescription.trim() || !!codeError}
            className="inline-flex items-center gap-2 rounded-lg bg-kv-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
          >
            {creatingReason ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("failureReasonCreateButton")}
          </button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("failureReasonDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("failureReasonDeleteConfirmDescription", { code: deleteTarget || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingCode !== null}>
              {t("failureReasonCancelButton")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) { handleDelete(deleteTarget); } }}
              disabled={deletingCode !== null}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deletingCode !== null ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("failureReasonDeleteConfirmButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
