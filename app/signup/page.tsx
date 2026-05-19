"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, User, Eye, EyeOff, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/components/language-selector";

export default function SignupPage() {
  const router = useRouter();
  const t = useTranslations("Signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || t("genericError"));
        return;
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false
      });

      if (result?.error) {
        setError(t("accountCreatedSignInFailed"));
      } else {
        router.replace("/dashboard");
      }
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-kv-green/5 via-white to-teal-50 px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/klantenvertellen-logo.jpg" alt="Klantenvertellen" className="h-12 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/kiyoh-logo.png" alt="Kiyoh" className="h-12 w-auto" />
          </Link>
          <p className="mt-4 text-gray-600">{t("subtitle")}</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("nameLabel")}
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 text-gray-900 focus:border-kv-green focus:outline-none focus:ring-2 focus:ring-kv-green/20"
                  placeholder={t("namePlaceholder")}
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("emailLabel")}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 text-gray-900 focus:border-kv-green focus:outline-none focus:ring-2 focus:ring-kv-green/20"
                  placeholder={t("emailPlaceholder")}
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("passwordLabel")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-12 text-gray-900 focus:border-kv-green focus:outline-none focus:ring-2 focus:ring-kv-green/20"
                  placeholder={t("passwordPlaceholder")}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("confirmPasswordLabel")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 text-gray-900 focus:border-kv-green focus:outline-none focus:ring-2 focus:ring-kv-green/20"
                  placeholder={t("passwordPlaceholder")}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-kv-green py-3 font-semibold text-white transition-colors hover:bg-kv-green/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t("submitting")}
                </>
              ) : (
                t("submitButton")
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            {t("hasAccount")}{" "}
            <Link
              href="/login"
              className="font-medium text-kv-green hover:text-kv-green/90"
            >
              {t("signInLink")}
            </Link>
          </p>
        </div>

        <div className="mt-4 flex justify-center">
          <LanguageSelector />
        </div>
      </motion.div>
    </div>
  );
}
