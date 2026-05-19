"use client";

import { useLocale } from "next-intl";
import { useState, useRef, useEffect } from "react";
import { Globe, Check } from "lucide-react";
import { SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_COOKIE_NAME } from "@/lib/i18n-config";
import type { SupportedLocale } from "@/lib/i18n-config";

export function LanguageSelector() {
  const currentLocale = useLocale() as SupportedLocale;
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLocaleChange = (locale: SupportedLocale) => {
    if (locale === currentLocale) {
      setOpen(false);
      return;
    }

    // Set cookie directly on the client — no async API call needed
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;

    // Hard reload to pick up the new locale server-side
    window.location.reload();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
        aria-label="Select language"
      >
        <Globe className="h-4 w-4" />
        <span className="hidden sm:inline">{currentLocale.toUpperCase()}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              onClick={() => handleLocaleChange(locale)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <span>{LOCALE_LABELS[locale]}</span>
              {locale === currentLocale && (
                <Check className="h-4 w-4 text-kv-green" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
