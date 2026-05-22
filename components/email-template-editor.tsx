"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Eye, Languages, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

type EmailType = "disable" | "verified" | "disputeVerified" | "finalRejection";

interface TemplateValues {
  emailType: string;
  locale: string;
  values: Record<string, string>;
}

interface PreviewResponse {
  subject: string;
  html: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EMAIL_TYPES: readonly EmailType[] = [
  "disable",
  "verified",
  "disputeVerified",
  "finalRejection",
];

const EMAIL_TYPE_KEYS: Readonly<Record<EmailType, readonly string[]>> = {
  disable: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "intro",
    "guidelinesLinkText",
    "requirementsIntro",
    "requirementCompanyName",
    "requirementDate",
    "requirementOrderNumber",
    "requirementCustomerName",
    "disputePrompt",
    "disputeButtonText",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
    "reasonLabel",
  ],
  verified: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "body",
    "thankYou",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
    "shopLabel",
    "dateLabel",
    "amountLabel",
  ],
  disputeVerified: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "body",
    "thankYou",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
    "shopLabel",
    "dateLabel",
    "amountLabel",
  ],
  finalRejection: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "body",
    "reasonLabel",
    "supportPrompt",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
  ],
};

const DEFAULT_LOCALE = "en";

// ─── Component ───────────────────────────────────────────────────────────────

export function EmailTemplateEditor() {
  const { toast } = useToast();
  const t = useTranslations("EmailTemplateEditor");

  const [selectedEmailType, setSelectedEmailType] = useState<EmailType>("disable");
  const [currentValues, setCurrentValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");

  // ─── Dirty State ─────────────────────────────────────────────────────────

  function getDirtyKeys(): string[] {
    const dirtyKeys: string[] = [];
    const keys = EMAIL_TYPE_KEYS[selectedEmailType];
    for (const key of keys) {
      const currentValue = currentValues[key] || "";
      const savedValue = savedValues[key] || "";
      if (currentValue !== savedValue) {
        dirtyKeys.push(key);
      }
    }
    return dirtyKeys;
  }

  const dirtyKeys = getDirtyKeys();
  const hasDirtyKeys = dirtyKeys.length > 0;

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchTemplateValues = useCallback(async (emailType: EmailType) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/email-templates?emailType=${emailType}&locale=${DEFAULT_LOCALE}`
      );
      if (response.ok) {
        const data: TemplateValues = await response.json();
        setCurrentValues(data.values);
        setSavedValues(data.values);
      } else {
        toast({
          title: t("loadFailed"),
          description: t("loadFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("loadFailed"),
        description: t("loadFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    fetchTemplateValues(selectedEmailType);
  }, [selectedEmailType, fetchTemplateValues]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleEmailTypeChange = (value: string) => {
    setSelectedEmailType(value as EmailType);
  };

  const handleFieldChange = (key: string, value: string) => {
    setCurrentValues((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/email-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailType: selectedEmailType,
          locale: DEFAULT_LOCALE,
          overrides: currentValues,
        }),
      });

      if (response.ok) {
        setSavedValues({ ...currentValues });
        toast({
          title: t("saveSuccess"),
          description: t("saveSuccessDescription"),
        });
      } else {
        toast({
          title: t("saveFailed"),
          description: t("saveFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("saveFailed"),
        description: t("saveFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAutoTranslate = async () => {
    const entries = dirtyKeys.map((key) => ({
      key,
      value: currentValues[key] || "",
    }));

    setTranslating(true);
    try {
      const response = await fetch("/api/admin/email-templates/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailType: selectedEmailType,
          sourceLocale: DEFAULT_LOCALE,
          entries,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const translatedCount: number = data.translated;
        const failedKeys: string[] = data.failed;

        // Update saved values for successfully translated keys
        const updatedSaved = { ...savedValues };
        for (const key of dirtyKeys) {
          if (!failedKeys.includes(key)) {
            updatedSaved[key] = currentValues[key] || "";
          }
        }
        setSavedValues(updatedSaved);

        if (failedKeys.length > 0) {
          toast({
            title: t("translatePartialSuccess"),
            description: t("translatePartialSuccessDescription", {
              translated: translatedCount,
              failed: failedKeys.length,
            }),
          });
        } else {
          toast({
            title: t("translateSuccess"),
            description: t("translateSuccessDescription", {
              count: translatedCount,
            }),
          });
        }
      } else {
        toast({
          title: t("translateFailed"),
          description: t("translateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("translateFailed"),
        description: t("translateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setTranslating(false);
    }
  };

  const handlePreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewSubject("");
    setPreviewHtml("");

    try {
      const response = await fetch("/api/admin/email-templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailType: selectedEmailType,
          overrides: currentValues,
        }),
      });

      if (response.ok) {
        const data: PreviewResponse = await response.json();
        setPreviewSubject(data.subject);
        setPreviewHtml(data.html);
      } else {
        toast({
          title: t("previewFailed"),
          description: t("previewFailedDescription"),
          variant: "destructive",
        });
        setPreviewOpen(false);
      }
    } catch {
      toast({
        title: t("previewFailed"),
        description: t("previewFailedDescription"),
        variant: "destructive",
      });
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const keys = EMAIL_TYPE_KEYS[selectedEmailType];

  return (
    <div className="space-y-3">
      {/* Email Type Selector */}
      <div>
        <Select value={selectedEmailType} onValueChange={handleEmailTypeChange}>
          <SelectTrigger className="w-full max-w-xs" aria-label={t("emailTypeLabel")}>
            <SelectValue placeholder={t("emailTypePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {EMAIL_TYPES.map((emailType) => (
              <SelectItem key={emailType} value={emailType}>
                {t(`emailType_${emailType}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template Fields */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-kv-green" />
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div key={key} className="flex items-start gap-3">
              <label
                htmlFor={`template-field-${key}`}
                className="w-36 shrink-0 pt-1.5 text-xs font-medium text-gray-700"
              >
                {t(`key_${key}`)}
              </label>
              <textarea
                id={`template-field-${key}`}
                value={currentValues[key] || ""}
                onChange={(event) => handleFieldChange(key, event.target.value)}
                rows={2}
                className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 placeholder:text-gray-400"
                aria-label={t(`key_${key}`)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-kv-green px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t("saveButton")}
          </button>

          <button
            type="button"
            onClick={handleAutoTranslate}
            disabled={!hasDirtyKeys || translating}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {translating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Languages className="h-3.5 w-3.5" />
            )}
            {t("autoTranslateButton")}
          </button>

          <button
            type="button"
            onClick={handlePreview}
            disabled={previewLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {previewLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {t("previewButton")}
          </button>
        </div>
      )}

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("previewTitle")}</DialogTitle>
            <DialogDescription>
              {(() => {
                if (previewSubject) {
                  return previewSubject;
                }
                return t("previewLoading");
              })()}
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-kv-green" />
            </div>
          ) : (
            <div className="overflow-auto">
              <p className="mb-2 text-sm font-medium text-gray-900">
                {t("subjectLabel")}: {previewSubject}
              </p>
              <iframe
                srcDoc={previewHtml}
                title={t("previewIframeTitle")}
                className="h-[60vh] w-full rounded-lg border border-gray-200"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
