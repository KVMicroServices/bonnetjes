"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/header";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";

export default function UserSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const translation = useTranslations("UserSettings");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return null;
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Settings className="mb-4 h-12 w-12 text-gray-400" />
          <h1 className="text-2xl font-bold text-gray-900">
            {translation("title")}
          </h1>
          <p className="mt-2 text-gray-500">
            {translation("comingSoon")}
          </p>
        </div>
      </main>
    </div>
  );
}
