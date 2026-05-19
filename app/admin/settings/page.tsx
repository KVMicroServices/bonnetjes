"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/header";
import { Settings, Users, Loader2, Zap } from "lucide-react";
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

interface FeatureToggles {
  autoVerifyEnabled: boolean;
  autoDisableEnabled: boolean;
}

export default function SettingsPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("Settings");
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [toggles, setToggles] = useState<FeatureToggles>({
    autoVerifyEnabled: false,
    autoDisableEnabled: false,
  });
  const [updatingToggle, setUpdatingToggle] = useState<string | null>(null);

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

  const fetchToggles = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/settings");
      if (response.ok) {
        const data = await response.json();
        setToggles(data);
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
        Promise.all([fetchUsers(), fetchToggles()]).finally(() => {
          setLoading(false);
        });
      }
    }
  }, [status, isAdmin, router, fetchUsers, fetchToggles]);

  const handleToggleChange = async (key: keyof FeatureToggles, value: boolean) => {
    setUpdatingToggle(key);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });

      if (response.ok) {
        const updatedToggles = await response.json();
        setToggles(updatedToggles);
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
      setUpdatingToggle(null);
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
                checked={toggles.autoVerifyEnabled}
                onCheckedChange={(checked) => handleToggleChange("autoVerifyEnabled", checked)}
                disabled={updatingToggle === "autoVerifyEnabled"}
                aria-label={t("autoVerifyLabel")}
              />
            </div>

            {/* Auto Disable Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{t("autoDisableLabel")}</p>
                <p className="text-sm text-gray-500">{t("autoDisableDescription")}</p>
              </div>
              <Switch
                checked={toggles.autoDisableEnabled}
                onCheckedChange={(checked) => handleToggleChange("autoDisableEnabled", checked)}
                disabled={updatingToggle === "autoDisableEnabled"}
                aria-label={t("autoDisableLabel")}
              />
            </div>
          </div>
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
                      {user.name || "—"}
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
