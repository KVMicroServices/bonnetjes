"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/header";
import { FailureReasonManagement } from "@/components/failure-reason-management";
import { EmailTemplateEditor } from "@/components/email-template-editor";
import { Settings, Users, Loader2, Zap, SlidersHorizontal, MapPin, Plus, X, Mail, MessageSquare, AlertTriangle, FileText } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";

interface UserData {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
  _count: { receipts: number };
}

interface AppSettings {
  autoVerifyEnabled: boolean;
  autoDisableEnabled: boolean;
  autoDisableLocationWhitelist: string[];
  highConfidenceThreshold: number;
  receiptMaxAgeMonths: number;
  ocrPromptCriteria: string | null;
  secondaryPromptCriteria: string | null;
  defaultOcrPromptCriteria: string;
  defaultSecondaryPromptCriteria: string;
  availableFailureReasons: string[];
  smtp: {
    smtpHost: string | null;
    smtpPort: string | null;
    smtpUser: string | null;
    smtpPass: string | null;
    smtpFrom: string | null;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MIN_RECEIPT_MAX_AGE_MONTHS = 1;
const MAX_RECEIPT_MAX_AGE_MONTHS = 120;

export default function SettingsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("Settings");
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    autoVerifyEnabled: false,
    autoDisableEnabled: false,
    autoDisableLocationWhitelist: [],
    highConfidenceThreshold: 70,
    receiptMaxAgeMonths: 6,
    ocrPromptCriteria: null,
    secondaryPromptCriteria: null,
    defaultOcrPromptCriteria: "",
    defaultSecondaryPromptCriteria: "",
    availableFailureReasons: [],
    smtp: {
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPass: null,
      smtpFrom: null,
    },
  });
  const [updatingSetting, setUpdatingSetting] = useState<string | null>(null);
  const [highThresholdInput, setHighThresholdInput] = useState("70");
  const [maxAgeInput, setMaxAgeInput] = useState("6");
  const [ocrPromptInput, setOcrPromptInput] = useState("");
  const [secondaryPromptInput, setSecondaryPromptInput] = useState("");
  const [savingOcrPrompt, setSavingOcrPrompt] = useState(false);
  const [savingSecondaryPrompt, setSavingSecondaryPrompt] = useState(false);
  const [newLocationId, setNewLocationId] = useState("");
  const [smtpForm, setSmtpForm] = useState({
    smtpHost: "",
    smtpPort: "",
    smtpUser: "",
    smtpPass: "",
    smtpFrom: "",
  });
  const [savingSmtp, setSavingSmtp] = useState(false);

  const isAdmin = (session?.user as any)?.role === "admin";

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users");
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch {
      // Fetch failed silently
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/settings");
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setHighThresholdInput(String(data.highConfidenceThreshold));
        setMaxAgeInput(String(data.receiptMaxAgeMonths));

        let ocrPromptValue = "";
        if (data.ocrPromptCriteria) {
          ocrPromptValue = data.ocrPromptCriteria;
        } else if (data.defaultOcrPromptCriteria) {
          ocrPromptValue = data.defaultOcrPromptCriteria;
        }
        setOcrPromptInput(ocrPromptValue);

        let secondaryPromptValue = "";
        if (data.secondaryPromptCriteria) {
          secondaryPromptValue = data.secondaryPromptCriteria;
        } else if (data.defaultSecondaryPromptCriteria) {
          secondaryPromptValue = data.defaultSecondaryPromptCriteria;
        }
        setSecondaryPromptInput(secondaryPromptValue);

        let smtpHostValue = "";
        if (data.smtp && data.smtp.smtpHost) {
          smtpHostValue = data.smtp.smtpHost;
        }
        let smtpPortValue = "";
        if (data.smtp && data.smtp.smtpPort) {
          smtpPortValue = data.smtp.smtpPort;
        }
        let smtpUserValue = "";
        if (data.smtp && data.smtp.smtpUser) {
          smtpUserValue = data.smtp.smtpUser;
        }
        let smtpPassValue = "";
        if (data.smtp && data.smtp.smtpPass) {
          smtpPassValue = data.smtp.smtpPass;
        }
        let smtpFromValue = "";
        if (data.smtp && data.smtp.smtpFrom) {
          smtpFromValue = data.smtp.smtpFrom;
        }
        setSmtpForm({
          smtpHost: smtpHostValue,
          smtpPort: smtpPortValue,
          smtpUser: smtpUserValue,
          smtpPass: smtpPassValue,
          smtpFrom: smtpFromValue,
        });
      }
    } catch {
      // Fetch failed silently
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated") {
      if (!isAdmin) {
        router.replace("/admin");
      } else {
        Promise.all([fetchUsers(), fetchSettings()]).finally(() => {
          setLoading(false);
        });
      }
    }
  }, [status, isAdmin, router, fetchUsers, fetchSettings]);

  const updateSetting = async (key: string, value: boolean | number | string[]) => {
    setUpdatingSetting(key);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        setHighThresholdInput(String(updatedSettings.highConfidenceThreshold));
        setMaxAgeInput(String(updatedSettings.receiptMaxAgeMonths));
        toast({
          title: t("settingUpdated"),
          description: t("settingUpdatedDescription"),
        });
      } else {
        toast({
          title: t("settingUpdateFailed"),
          description: t("settingUpdateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("settingUpdateFailed"),
        description: t("settingUpdateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setUpdatingSetting(null);
    }
  };

  const handleThresholdBlur = (key: string, inputValue: string, currentValue: number) => {
    const parsed = parseInt(inputValue, 10);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      setHighThresholdInput(String(currentValue));
      return;
    }
    if (parsed !== currentValue) {
      updateSetting(key, parsed);
    }
  };

  const handleMaxAgeBlur = () => {
    const parsed = parseInt(maxAgeInput, 10);
    if (isNaN(parsed) || parsed < MIN_RECEIPT_MAX_AGE_MONTHS || parsed > MAX_RECEIPT_MAX_AGE_MONTHS) {
      setMaxAgeInput(String(settings.receiptMaxAgeMonths));
      return;
    }
    if (parsed !== settings.receiptMaxAgeMonths) {
      updateSetting("receiptMaxAgeMonths", parsed);
    }
  };

  const handleSaveOcrPrompt = async () => {
    setSavingOcrPrompt(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ocrPromptCriteria: ocrPromptInput }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        toast({
          title: t("settingUpdated"),
          description: t("promptSaved"),
        });
      } else {
        toast({
          title: t("settingUpdateFailed"),
          description: t("settingUpdateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("settingUpdateFailed"),
        description: t("settingUpdateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setSavingOcrPrompt(false);
    }
  };

  const handleSaveSecondaryPrompt = async () => {
    setSavingSecondaryPrompt(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondaryPromptCriteria: secondaryPromptInput }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        toast({
          title: t("settingUpdated"),
          description: t("promptSaved"),
        });
      } else {
        toast({
          title: t("settingUpdateFailed"),
          description: t("settingUpdateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("settingUpdateFailed"),
        description: t("settingUpdateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setSavingSecondaryPrompt(false);
    }
  };

  const handleResetOcrPrompt = () => {
    setOcrPromptInput(settings.defaultOcrPromptCriteria);
    handleSaveOcrPromptWithValue("");
  };

  const handleResetSecondaryPrompt = () => {
    setSecondaryPromptInput(settings.defaultSecondaryPromptCriteria);
    handleSaveSecondaryPromptWithValue("");
  };

  const handleSaveOcrPromptWithValue = async (value: string) => {
    setSavingOcrPrompt(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ocrPromptCriteria: value }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        toast({
          title: t("settingUpdated"),
          description: t("promptReset"),
        });
      }
    } catch {
      toast({
        title: t("settingUpdateFailed"),
        description: t("settingUpdateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setSavingOcrPrompt(false);
    }
  };

  const handleSaveSecondaryPromptWithValue = async (value: string) => {
    setSavingSecondaryPrompt(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondaryPromptCriteria: value }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        toast({
          title: t("settingUpdated"),
          description: t("promptReset"),
        });
      }
    } catch {
      toast({
        title: t("settingUpdateFailed"),
        description: t("settingUpdateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setSavingSecondaryPrompt(false);
    }
  };

  const handleAddLocation = async () => {
    const trimmed = newLocationId.trim();
    if (!trimmed) {
      return;
    }
    if (settings.autoDisableLocationWhitelist.includes(trimmed)) {
      toast({
        title: t("locationAlreadyExists"),
        description: t("locationAlreadyExistsDescription"),
        variant: "destructive",
      });
      return;
    }
    const updatedList = [...settings.autoDisableLocationWhitelist, trimmed];
    setNewLocationId("");
    await updateSetting("autoDisableLocationWhitelist", updatedList);
  };

  const handleRemoveLocation = async (locationId: string) => {
    const updatedList = settings.autoDisableLocationWhitelist.filter(
      (item) => item !== locationId
    );
    await updateSetting("autoDisableLocationWhitelist", updatedList);
  };

  const handleSmtpSave = async () => {
    setSavingSmtp(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtpHost: smtpForm.smtpHost,
          smtpPort: smtpForm.smtpPort,
          smtpUser: smtpForm.smtpUser,
          smtpPass: smtpForm.smtpPass,
          smtpFrom: smtpForm.smtpFrom,
        }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        toast({
          title: t("settingUpdated"),
          description: t("smtpSaved"),
        });
      } else {
        toast({
          title: t("settingUpdateFailed"),
          description: t("settingUpdateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("settingUpdateFailed"),
        description: t("settingUpdateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingUserId(userId);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });

      if (response.ok) {
        const updatedUser = await response.json();
        setUsers((previousUsers) =>
          previousUsers.map((user) => {
            if (user.id === userId) {
              return { ...user, role: updatedUser.role };
            }
            return user;
          })
        );
        toast({
          title: t("roleUpdated"),
          description: t("roleUpdatedDescription", { role: newRole }),
        });
      } else {
        toast({
          title: t("roleUpdateFailed"),
          description: t("roleUpdateFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("roleUpdateFailed"),
        description: t("roleUpdateFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (status === "loading" || (status === "authenticated" && loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-kv-green" />
      </div>
    );
  }

  if (status === "unauthenticated" || !isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-kv-green/10 p-3">
            <Settings className="h-6 w-6 text-kv-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
            <p className="text-gray-600">{t("subtitle")}</p>
          </div>
        </div>

        {/* Feature Toggles Section */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <Zap className="h-5 w-5 text-kv-green" />
            <h2 className="text-lg font-semibold text-gray-900">
              {t("featureToggles")}
            </h2>
          </div>

          <div className="space-y-6">
            {/* Auto Verify Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{t("autoVerifyLabel")}</p>
                <p className="text-sm text-gray-500">{t("autoVerifyDescription")}</p>
              </div>
              <Switch
                checked={settings.autoVerifyEnabled}
                onCheckedChange={(checked) => updateSetting("autoVerifyEnabled", checked)}
                disabled={updatingSetting === "autoVerifyEnabled"}
                aria-label={t("autoVerifyLabel")}
              />
            </div>

            {/* Location Whitelist */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-kv-green" />
                <p className="font-medium text-gray-900">{t("locationWhitelistLabel")}</p>
              </div>
              <p className="mb-4 text-sm text-gray-500">{t("locationWhitelistDescription")}</p>

              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newLocationId}
                  onChange={(event) => setNewLocationId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleAddLocation();
                    }
                  }}
                  placeholder={t("locationWhitelistPlaceholder")}
                  disabled={updatingSetting === "autoDisableLocationWhitelist"}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 placeholder:text-gray-400 disabled:opacity-50"
                  aria-label={t("locationWhitelistPlaceholder")}
                />
                <button
                  type="button"
                  onClick={handleAddLocation}
                  disabled={updatingSetting === "autoDisableLocationWhitelist" || !newLocationId.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-kv-green px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
                  aria-label={t("locationWhitelistAdd")}
                >
                  <Plus className="h-4 w-4" />
                  {t("locationWhitelistAdd")}
                </button>
              </div>

              {settings.autoDisableLocationWhitelist.length === 0 && (
                <p className="text-sm italic text-gray-400">{t("locationWhitelistEmpty")}</p>
              )}

              {settings.autoDisableLocationWhitelist.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {settings.autoDisableLocationWhitelist.map((locationId) => (
                    <span
                      key={locationId}
                      className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                    >
                      {locationId}
                      <button
                        type="button"
                        onClick={() => handleRemoveLocation(locationId)}
                        disabled={updatingSetting === "autoDisableLocationWhitelist"}
                        className="ml-1 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 disabled:opacity-50"
                        aria-label={t("locationWhitelistRemove")}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Auto Disable Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{t("autoDisableLabel")}</p>
                <p className="text-sm text-gray-500">{t("autoDisableDescription")}</p>
              </div>
              <Switch
                checked={settings.autoDisableEnabled}
                onCheckedChange={(checked) => updateSetting("autoDisableEnabled", checked)}
                disabled={updatingSetting === "autoDisableEnabled"}
                aria-label={t("autoDisableLabel")}
              />
            </div>
          </div>
        </div>

        {/* Confidence Thresholds Section */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-kv-green" />
            <h2 className="text-lg font-semibold text-gray-900">
              {t("confidenceThresholds")}
            </h2>
          </div>

          <p className="mb-6 text-sm text-gray-500">{t("confidenceThresholdsDescription")}</p>

          <div className="space-y-6">
            {/* High Confidence Threshold */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{t("highConfidenceLabel")}</p>
                <p className="text-sm text-gray-500">{t("highConfidenceDescription")}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={highThresholdInput}
                  onChange={(event) => setHighThresholdInput(event.target.value)}
                  onBlur={() => handleThresholdBlur("highConfidenceThreshold", highThresholdInput, settings.highConfidenceThreshold)}
                  disabled={updatingSetting === "highConfidenceThreshold"}
                  className="w-20 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center text-sm text-gray-700 disabled:opacity-50"
                  aria-label={t("highConfidenceLabel")}
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>

            {/* Receipt Max Age */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{t("maxAgeLabel")}</p>
                <p className="text-sm text-gray-500">{t("maxAgeDescription")}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={MIN_RECEIPT_MAX_AGE_MONTHS}
                  max={MAX_RECEIPT_MAX_AGE_MONTHS}
                  value={maxAgeInput}
                  onChange={(event) => setMaxAgeInput(event.target.value)}
                  onBlur={handleMaxAgeBlur}
                  disabled={updatingSetting === "receiptMaxAgeMonths"}
                  className="w-20 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center text-sm text-gray-700 disabled:opacity-50"
                  aria-label={t("maxAgeLabel")}
                />
                <span className="text-sm text-gray-500">{t("months")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* AI Prompts Section */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-kv-green" />
            <h2 className="text-lg font-semibold text-gray-900">
              {t("aiPromptsTitle")}
            </h2>
          </div>

          <p className="mb-6 text-sm text-gray-500">{t("aiPromptsDescription")}</p>

          <div className="space-y-6">
            {/* Failure Reasons Management */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-kv-green" />
                <p className="text-sm font-medium text-gray-900">{t("failureReasonsLabel")}</p>
              </div>
              <p className="mb-4 text-xs text-gray-500">{t("failureReasonsManagementDescription")}</p>

              <FailureReasonManagement />
            </div>

            {/* Primary OCR Prompt */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="ocr-prompt" className="block text-sm font-medium text-gray-900">
                  {t("ocrPromptLabel")}
                </label>
                <button
                  type="button"
                  onClick={handleResetOcrPrompt}
                  disabled={savingOcrPrompt}
                  className="text-xs text-gray-500 underline transition-colors hover:text-gray-700 disabled:opacity-50"
                >
                  {t("resetToDefault")}
                </button>
              </div>
              <p className="mb-2 text-xs text-gray-500">{t("ocrPromptDescription")}</p>
              <textarea
                id="ocr-prompt"
                value={ocrPromptInput}
                onChange={(event) => setOcrPromptInput(event.target.value)}
                placeholder={t("ocrPromptPlaceholder")}
                rows={12}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-700 placeholder:text-gray-400"
              />
              <div className="mt-2">
                <button
                  type="button"
                  onClick={handleSaveOcrPrompt}
                  disabled={savingOcrPrompt}
                  className="inline-flex items-center gap-2 rounded-lg bg-kv-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
                >
                  {(() => { if (savingOcrPrompt) { return <Loader2 className="h-4 w-4 animate-spin" />; } return null; })()}
                  {t("savePrompt")}
                </button>
              </div>
            </div>

            {/* Secondary Analysis Prompt */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="secondary-prompt" className="block text-sm font-medium text-gray-900">
                  {t("secondaryPromptLabel")}
                </label>
                <button
                  type="button"
                  onClick={handleResetSecondaryPrompt}
                  disabled={savingSecondaryPrompt}
                  className="text-xs text-gray-500 underline transition-colors hover:text-gray-700 disabled:opacity-50"
                >
                  {t("resetToDefault")}
                </button>
              </div>
              <p className="mb-2 text-xs text-gray-500">{t("secondaryPromptDescription")}</p>
              <textarea
                id="secondary-prompt"
                value={secondaryPromptInput}
                onChange={(event) => setSecondaryPromptInput(event.target.value)}
                placeholder={t("secondaryPromptPlaceholder")}
                rows={12}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-700 placeholder:text-gray-400"
              />
              <div className="mt-2">
                <button
                  type="button"
                  onClick={handleSaveSecondaryPrompt}
                  disabled={savingSecondaryPrompt}
                  className="inline-flex items-center gap-2 rounded-lg bg-kv-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
                >
                  {(() => { if (savingSecondaryPrompt) { return <Loader2 className="h-4 w-4 animate-spin" />; } return null; })()}
                  {t("savePrompt")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SMTP Configuration Section */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <Mail className="h-5 w-5 text-kv-green" />
            <h2 className="text-lg font-semibold text-gray-900">
              {t("smtpTitle")}
            </h2>
          </div>

          <p className="mb-6 text-sm text-gray-500">{t("smtpDescription")}</p>

          <div className="space-y-4">
            <div>
              <label htmlFor="smtp-host" className="mb-1 block text-sm font-medium text-gray-900">
                {t("smtpHostLabel")}
              </label>
              <input
                id="smtp-host"
                type="text"
                value={smtpForm.smtpHost}
                onChange={(event) => setSmtpForm({ ...smtpForm, smtpHost: event.target.value })}
                placeholder={t("smtpHostPlaceholder")}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400"
              />
            </div>

            <div>
              <label htmlFor="smtp-port" className="mb-1 block text-sm font-medium text-gray-900">
                {t("smtpPortLabel")}
              </label>
              <input
                id="smtp-port"
                type="text"
                value={smtpForm.smtpPort}
                onChange={(event) => setSmtpForm({ ...smtpForm, smtpPort: event.target.value })}
                placeholder={t("smtpPortPlaceholder")}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400"
              />
            </div>

            <div>
              <label htmlFor="smtp-user" className="mb-1 block text-sm font-medium text-gray-900">
                {t("smtpUserLabel")}
              </label>
              <input
                id="smtp-user"
                type="text"
                value={smtpForm.smtpUser}
                onChange={(event) => setSmtpForm({ ...smtpForm, smtpUser: event.target.value })}
                placeholder={t("smtpUserPlaceholder")}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400"
              />
            </div>

            <div>
              <label htmlFor="smtp-pass" className="mb-1 block text-sm font-medium text-gray-900">
                {t("smtpPassLabel")}
              </label>
              <input
                id="smtp-pass"
                type="password"
                value={smtpForm.smtpPass}
                onChange={(event) => setSmtpForm({ ...smtpForm, smtpPass: event.target.value })}
                placeholder={t("smtpPassPlaceholder")}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400"
              />
            </div>

            <div>
              <label htmlFor="smtp-from" className="mb-1 block text-sm font-medium text-gray-900">
                {t("smtpFromLabel")}
              </label>
              <input
                id="smtp-from"
                type="text"
                value={smtpForm.smtpFrom}
                onChange={(event) => setSmtpForm({ ...smtpForm, smtpFrom: event.target.value })}
                placeholder={t("smtpFromPlaceholder")}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleSmtpSave}
                disabled={savingSmtp}
                className="inline-flex items-center gap-2 rounded-lg bg-kv-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
              >
                {(() => { if (savingSmtp) { return <Loader2 className="h-4 w-4 animate-spin" />; } return null; })()}
                {t("smtpSaveButton")}
              </button>
            </div>
          </div>
        </div>

        {/* Email Templates Section */}
        <div className="mb-8 rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-kv-green" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {t("emailTemplatesTitle")}
              </h2>
              <p className="text-sm text-gray-500">{t("emailTemplatesDescription")}</p>
            </div>
          </div>

          <EmailTemplateEditor />
        </div>

        {/* User Management Section */}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Users className="h-5 w-5 text-kv-green" />
              {t("userManagement")}
            </h2>
            <span className="text-sm text-gray-500">
              {t("usersCount", { count: users.length })}
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t("columnName")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t("columnEmail")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t("columnReceipts")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t("columnRole")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {user.name ? user.name : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {user.email}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {user._count.receipts}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(event) =>
                          handleRoleChange(user.id, event.target.value)
                        }
                        disabled={updatingUserId === user.id}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      {updatingUserId === user.id && (
                        <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-gray-400" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
