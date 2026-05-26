"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MILLISECONDS = 30000;
const MAX_DROPDOWN_ITEMS = 10;
const MAX_DISPLAYED_COUNT = 99;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_SECOND = 1000;

// ─── Component ───────────────────────────────────────────────────────────────

export function NotificationBell() {
  const t = useTranslations("Notifications");
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const relativeTimeTranslations: RelativeTimeTranslations = {
    justNow: t("justNow"),
    minutesAgo: (minutes: number) => t("minutesAgo", { count: String(minutes) }),
    hoursAgo: (hours: number) => t("hoursAgo", { count: String(hours) }),
    daysAgo: (days: number) => t("daysAgo", { count: String(days) }),
  };

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?type=count");
      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.count);
      }
    } catch {
      // Silent failure for polling
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications);
      }
    } catch {
      // Silent failure
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      setUnreadCount(0);
    } catch {
      // Silent failure
    }
  }, []);

  // Poll for unread count
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, POLL_INTERVAL_MILLISECONDS);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch full list when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  function handleToggle() {
    setIsOpen(!isOpen);
  }

  function handleMarkAllRead() {
    markAllAsRead();
  }

  const displayedNotifications = notifications.slice(0, MAX_DROPDOWN_ITEMS);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={handleToggle}
        className="relative rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100"
        aria-label={t("bellLabel")}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {(() => {
              if (unreadCount > MAX_DISPLAYED_COUNT) {
                return `${MAX_DISPLAYED_COUNT}+`;
              }
              return unreadCount;
            })()}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border bg-white shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">
              {t("title")}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                {t("markAllRead")}
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto">
            {displayedNotifications.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                {t("empty")}
              </div>
            )}
            {displayedNotifications.map((notification) => (
              <div
                key={notification.id}
                className="border-b px-4 py-3 transition-colors hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {notification.title}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">
                    {notification.body}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {formatRelativeTime(notification.createdAt, relativeTimeTranslations)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RelativeTimeTranslations {
  justNow: string;
  minutesAgo: (minutes: number) => string;
  hoursAgo: (hours: number) => string;
  daysAgo: (days: number) => string;
}

function formatRelativeTime(dateString: string, translations: RelativeTimeTranslations): string {
  const date = new Date(dateString);
  const now = new Date();
  const elapsedMilliseconds = now.getTime() - date.getTime();
  const differenceSeconds = Math.floor(elapsedMilliseconds / MILLISECONDS_PER_SECOND);

  if (differenceSeconds < SECONDS_PER_MINUTE) {
    return translations.justNow;
  }

  const differenceMinutes = Math.floor(differenceSeconds / SECONDS_PER_MINUTE);
  if (differenceMinutes < MINUTES_PER_HOUR) {
    return translations.minutesAgo(differenceMinutes);
  }

  const differenceHours = Math.floor(differenceMinutes / MINUTES_PER_HOUR);
  if (differenceHours < HOURS_PER_DAY) {
    return translations.hoursAgo(differenceHours);
  }

  const differenceDays = Math.floor(differenceHours / HOURS_PER_DAY);
  return translations.daysAgo(differenceDays);
}
