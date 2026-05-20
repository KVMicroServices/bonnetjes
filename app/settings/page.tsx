"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/header";
import { Settings, Bell, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationPreference {
  type: string;
  channel: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NOTIFICATION_TYPES: ReadonlyArray<string> = [
  "receipt_requires_review",
  "receipt_processed",
  "review_disabled",
  "dispute_outcome",
  "role_changed",
];

const CHANNEL_OPTIONS: ReadonlyArray<string> = ["none", "in_app", "email"];

// ─── Component ───────────────────────────────────────────────────────────────

export default function UserSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("UserSettings");

  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/notifications/preferences");
      if (response.ok) {
        const data = await response.json();
        setPreferences(data.preferences);
      }
    } catch {
      // Silent failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchPreferences();
    }
  }, [session, fetchPreferences]);

  async function handleChannelChange(type: string, channel: string) {
    setUpdating(type);
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, channel }),
      });
      if (response.ok) {
        const data = await response.json();
        setPreferences(data.preferences);
      }
    } catch {
      // Silent failure
    } finally {
      setUpdating(null);
    }
  }

  if (status === "loading") {
    return null;
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
        </div>

        {/* Notification Preferences Section */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">
              {t("notificationsTitle")}
            </h2>
          </div>
          <p className="mb-6 text-sm text-gray-500">
            {t("notificationsDescription")}
          </p>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          )}

          {!loading && (
            <div className="space-y-4">
              {NOTIFICATION_TYPES.map((type) => {
                const preference = preferences.find((p) => p.type === type);
                const currentChannel = preference ? preference.channel : "in_app";
                const isUpdating = updating === type;

                return (
                  <div
                    key={type}
                    className="flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {t(`type_${type}`)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t(`typeDescription_${type}`)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isUpdating && (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      )}
                      <select
                        value={currentChannel}
                        onChange={(event) => handleChannelChange(type, event.target.value)}
                        disabled={isUpdating}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {CHANNEL_OPTIONS.map((channel) => (
                          <option key={channel} value={channel}>
                            {t(`channel_${channel}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
