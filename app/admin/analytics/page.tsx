"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/header";
import {
  BarChart3,
  Receipt,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Loader2,
  Inbox,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTranslations } from "next-intl";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnalyticsMetrics {
  totalReceipts: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  requiresReviewCount: number;
  flaggedCount: number;
  approvalRate: number;
  rejectionRate: number;
}

interface VolumeDataPoint {
  label: string;
  total: number;
  verified: number;
  rejected: number;
  pending: number;
  requiresReview: number;
}

type TabId = "metrics" | "volume" | "audit";
type Granularity = "hour" | "day" | "week";

// ─── Constants ───────────────────────────────────────────────────────────────

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;
const MILLISECONDS_PER_THIRTY_DAYS = 30 * MILLISECONDS_PER_DAY;
const CHART_BAR_WIDTH_PX = 50;
const CHART_MIN_WIDTH_PX = 600;
const ROTATED_LABEL_THRESHOLD = 14;
const ROTATED_LABEL_ANGLE = -45;
const ROTATED_LABEL_HEIGHT = 80;
const DEFAULT_LABEL_HEIGHT = 40;

// ─── Component ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("Analytics");

  const [activeTab, setActiveTab] = useState<TabId>("metrics");
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
  const [volumeData, setVolumeData] = useState<ReadonlyArray<VolumeDataPoint>>([]);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [volumeDateFrom, setVolumeDateFrom] = useState<string>("");
  const [volumeDateTo, setVolumeDateTo] = useState<string>("");
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingVolume, setLoadingVolume] = useState(true);

  const isAdmin = (session?.user as any)?.role === "admin";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
    if (status === "authenticated" && !isAdmin) {
      router.push("/admin");
    }
  }, [status, isAdmin, router]);

  const fetchMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const response = await fetch("/api/admin/analytics");
      if (response.ok) {
        const data = await response.json();
        setMetrics(data);
      }
    } catch {
      // Metrics fetch failed silently
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  const fetchVolume = useCallback(async () => {
    setLoadingVolume(true);
    try {
      let url = `/api/admin/analytics?type=volume&granularity=${granularity}`;
      if (volumeDateFrom) {
        url = url + `&from=${volumeDateFrom}T00:00:00`;
      }
      if (volumeDateTo) {
        url = url + `&to=${volumeDateTo}T23:59:59`;
      }
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setVolumeData(data.data);
      }
    } catch {
      // Volume fetch failed silently
    } finally {
      setLoadingVolume(false);
    }
  }, [granularity, volumeDateFrom, volumeDateTo]);

  useEffect(() => {
    if (isAdmin) {
      fetchMetrics();
    }
  }, [isAdmin, fetchMetrics]);

  useEffect(() => {
    if (isAdmin) {
      fetchVolume();
    }
  }, [isAdmin, fetchVolume]);

  if (status === "loading" || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex gap-6">
            <TabButton
              active={activeTab === "metrics"}
              onClick={() => setActiveTab("metrics")}
              label={t("tabMetrics")}
            />
            <TabButton
              active={activeTab === "volume"}
              onClick={() => setActiveTab("volume")}
              label={t("tabVolume")}
            />
            <TabButton
              active={activeTab === "audit"}
              onClick={() => setActiveTab("audit")}
              label={t("tabAuditLog")}
            />
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === "metrics" && (
          <MetricsTab metrics={metrics} loading={loadingMetrics} />
        )}
        {activeTab === "volume" && (
          <VolumeTab
            data={volumeData}
            loading={loadingVolume}
            granularity={granularity}
            onGranularityChange={setGranularity}
            dateFrom={volumeDateFrom}
            dateTo={volumeDateTo}
            onDateFromChange={setVolumeDateFrom}
            onDateToChange={setVolumeDateTo}
          />
        )}
        {activeTab === "audit" && <AuditLogTab />}
      </main>
    </div>
  );
}

// ─── Tab Button ──────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  let buttonClassName = "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ";
  if (active) {
    buttonClassName = buttonClassName + "border-blue-500 text-blue-600";
  } else {
    buttonClassName = buttonClassName + "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700";
  }

  return (
    <button
      onClick={onClick}
      className={buttonClassName}
    >
      {label}
    </button>
  );
}

// ─── Metrics Tab ─────────────────────────────────────────────────────────────

function MetricsTab({
  metrics,
  loading,
}: {
  metrics: AnalyticsMetrics | null;
  loading: boolean;
}) {
  const t = useTranslations("Analytics");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center text-gray-500">
        {t("failedToLoad")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<Receipt className="h-5 w-5 text-blue-600" />}
          label={t("totalReceipts")}
          value={metrics.totalReceipts}
          bgColor="bg-blue-50"
        />
        <MetricCard
          icon={<CheckCircle className="h-5 w-5 text-green-600" />}
          label={t("approved")}
          value={metrics.approvedCount}
          bgColor="bg-green-50"
        />
        <MetricCard
          icon={<XCircle className="h-5 w-5 text-red-600" />}
          label={t("rejected")}
          value={metrics.rejectedCount}
          bgColor="bg-red-50"
        />
        <MetricCard
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          label={t("pending")}
          value={metrics.pendingCount}
          bgColor="bg-yellow-50"
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<AlertTriangle className="h-5 w-5 text-orange-600" />}
          label={t("requiresReview")}
          value={metrics.requiresReviewCount}
          bgColor="bg-orange-50"
        />
        <MetricCard
          icon={<AlertTriangle className="h-5 w-5 text-purple-600" />}
          label={t("flagged")}
          value={metrics.flaggedCount}
          bgColor="bg-purple-50"
        />
        <MetricCard
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          label={t("approvalRate")}
          value={`${metrics.approvalRate}%`}
          bgColor="bg-green-50"
        />
        <MetricCard
          icon={<TrendingDown className="h-5 w-5 text-red-600" />}
          label={t("rejectionRate")}
          value={`${metrics.rejectionRate}%`}
          bgColor="bg-red-50"
        />
      </div>
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  bgColor: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${bgColor}`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Volume Tab ──────────────────────────────────────────────────────────────

function VolumeTab({
  data,
  loading,
  granularity,
  onGranularityChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  data: ReadonlyArray<VolumeDataPoint>;
  loading: boolean;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
}) {
  const t = useTranslations("Analytics");

  function handleSetToday() {
    const todayDate = new Date();
    const todayString = todayDate.toISOString().split("T")[0];
    onDateFromChange(todayString);
    onDateToChange(todayString);
    onGranularityChange("hour");
  }

  function handleSetLastSevenDays() {
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - MILLISECONDS_PER_WEEK);
    const todayString = today.toISOString().split("T")[0];
    const sevenDaysAgoString = sevenDaysAgo.toISOString().split("T")[0];
    onDateFromChange(sevenDaysAgoString);
    onDateToChange(todayString);
    onGranularityChange("day");
  }

  function handleSetLastThirtyDays() {
    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - MILLISECONDS_PER_THIRTY_DAYS);
    const todayString = today.toISOString().split("T")[0];
    const thirtyDaysAgoString = thirtyDaysAgo.toISOString().split("T")[0];
    onDateFromChange(thirtyDaysAgoString);
    onDateToChange(todayString);
    onGranularityChange("day");
  }

  function handleClearRange() {
    onDateFromChange("");
    onDateToChange("");
  }

  return (
    <div className="space-y-4">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Granularity Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{t("groupBy")}:</span>
          <div className="flex rounded-lg border bg-white p-1">
            <GranularityButton
              active={granularity === "hour"}
              onClick={() => onGranularityChange("hour")}
              label={t("hourly")}
            />
            <GranularityButton
              active={granularity === "day"}
              onClick={() => onGranularityChange("day")}
              label={t("daily")}
            />
            <GranularityButton
              active={granularity === "week"}
              onClick={() => onGranularityChange("week")}
              label={t("weekly")}
            />
          </div>
        </div>

        {/* Date Range Inputs */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{t("dateRange")}:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            className="rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700"
          />
          <span className="text-sm text-gray-500">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            className="rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={handleClearRange}
              className="rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
            >
              {t("clearRange")}
            </button>
          )}
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSetToday}
          className="rounded-md border bg-white px-3 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50"
        >
          {t("presetToday")}
        </button>
        <button
          onClick={handleSetLastSevenDays}
          className="rounded-md border bg-white px-3 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50"
        >
          {t("presetLastSevenDays")}
        </button>
        <button
          onClick={handleSetLastThirtyDays}
          className="rounded-md border bg-white px-3 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50"
        >
          {t("presetLastThirtyDays")}
        </button>
      </div>

      {/* Chart */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        )}
        {!loading && data.length === 0 && (
          <div className="py-16 text-center text-gray-500">{t("noData")}</div>
        )}
        {!loading && data.length > 0 && (
          <div className="overflow-x-auto">
            <div style={{ minWidth: `${Math.max(data.length * CHART_BAR_WIDTH_PX, CHART_MIN_WIDTH_PX)}px` }}>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={data as VolumeDataPoint[]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12 }}
                    interval={0}
                    angle={data.length > ROTATED_LABEL_THRESHOLD ? ROTATED_LABEL_ANGLE : 0}
                    textAnchor={data.length > ROTATED_LABEL_THRESHOLD ? "end" : "middle"}
                    height={data.length > ROTATED_LABEL_THRESHOLD ? ROTATED_LABEL_HEIGHT : DEFAULT_LABEL_HEIGHT}
                  />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="verified"
                    name={t("legendVerified")}
                    fill="#22c55e"
                    stackId="stack"
                  />
                  <Bar
                    dataKey="requiresReview"
                    name={t("legendRequiresReview")}
                    fill="#f97316"
                    stackId="stack"
                  />
                  <Bar
                    dataKey="pending"
                    name={t("legendPending")}
                    fill="#eab308"
                    stackId="stack"
                  />
                  <Bar
                    dataKey="rejected"
                    name={t("legendRejected")}
                    fill="#ef4444"
                    stackId="stack"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Granularity Button ──────────────────────────────────────────────────────

function GranularityButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  let buttonClassName = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors ";
  if (active) {
    buttonClassName = buttonClassName + "bg-blue-100 text-blue-700";
  } else {
    buttonClassName = buttonClassName + "text-gray-600 hover:bg-gray-100";
  }

  return (
    <button
      onClick={onClick}
      className={buttonClassName}
    >
      {label}
    </button>
  );
}

// ─── Audit Log Tab ───────────────────────────────────────────────────────────

// ─── Audit Log Types ─────────────────────────────────────────────────────────

interface AuditLogEntry {
  id: string;
  category: string;
  action: string;
  actorId: string | null;
  metadata: string | null;
  createdAt: string;
}

interface AuditLogResponse {
  entries: ReadonlyArray<AuditLogEntry>;
  nextCursor: string | null;
  hasMore: boolean;
}

// ─── Audit Log Constants ─────────────────────────────────────────────────────

const AUDIT_CATEGORY_ALL = "all";

const RECEIPT_ID_PREVIEW_LENGTH = 8;

const AUDIT_CATEGORIES: ReadonlyArray<string> = [
  AUDIT_CATEGORY_ALL,
  "ai_judgement",
  "secondary_analysis",
  "moderation",
  "comment",
  "user_management",
  "settings",
  "system",
];

const CATEGORY_TRANSLATION_KEYS: Readonly<Record<string, string>> = {
  all: "auditFilterAll",
  ai_judgement: "auditFilterAiJudgement",
  secondary_analysis: "auditFilterSecondaryAnalysis",
  moderation: "auditFilterModeration",
  comment: "auditFilterComment",
  user_management: "auditFilterUserManagement",
  settings: "auditFilterSettings",
  system: "auditFilterSystem",
};

const CATEGORY_BADGE_COLORS: Readonly<Record<string, string>> = {
  ai_judgement: "bg-purple-100 text-purple-800",
  secondary_analysis: "bg-indigo-100 text-indigo-800",
  moderation: "bg-blue-100 text-blue-800",
  comment: "bg-green-100 text-green-800",
  user_management: "bg-orange-100 text-orange-800",
  settings: "bg-yellow-100 text-yellow-800",
  system: "bg-gray-100 text-gray-800",
};

// ─── Audit Log Helpers ───────────────────────────────────────────────────────

function resolveActorName(entry: AuditLogEntry, systemLabel: string): string {
  if (!entry.actorId) {
    return systemLabel;
  }

  if (!entry.metadata) {
    return entry.actorId;
  }

  try {
    const parsed = JSON.parse(entry.metadata);
    if (parsed.actorName) {
      return parsed.actorName;
    }
  } catch {
    // metadata is not valid JSON, fall through
  }

  return entry.actorId;
}

function buildSummary(entry: AuditLogEntry, t: (key: string, values?: Record<string, string>) => string): string {
  if (!entry.metadata) {
    return entry.action;
  }

  try {
    const parsed = JSON.parse(entry.metadata);

    if (parsed.receiptId && parsed.verdict) {
      const receiptPreview = parsed.receiptId.slice(0, RECEIPT_ID_PREVIEW_LENGTH);
      return t("summaryReceiptVerdict", { receiptId: receiptPreview, verdict: parsed.verdict });
    }

    if (parsed.targetUserId && parsed.newRole) {
      return t("summaryRoleChanged", { role: parsed.newRole });
    }

    if (parsed.changedKeys) {
      const keys = parsed.changedKeys as string[];
      return t("summaryUpdated", { keys: keys.join(", ") });
    }

    if (parsed.receiptId && parsed.action) {
      const receiptPreview = parsed.receiptId.slice(0, RECEIPT_ID_PREVIEW_LENGTH);
      return t("summaryReceiptVerdict", { receiptId: receiptPreview, verdict: parsed.action });
    }

    if (parsed.receiptId && parsed.outcome) {
      const receiptPreview = parsed.receiptId.slice(0, RECEIPT_ID_PREVIEW_LENGTH);
      return t("summaryReceiptVerdict", { receiptId: receiptPreview, verdict: parsed.outcome });
    }

    if (parsed.receiptId && parsed.reviewId) {
      const receiptPreview = parsed.receiptId.slice(0, RECEIPT_ID_PREVIEW_LENGTH);
      return t("summaryReceipt", { receiptId: receiptPreview });
    }

    if (parsed.receiptId) {
      const receiptPreview = parsed.receiptId.slice(0, RECEIPT_ID_PREVIEW_LENGTH);
      return t("summaryReceipt", { receiptId: receiptPreview });
    }
  } catch {
    // metadata is not valid JSON, fall through
  }

  return entry.action;
}

// ─── Audit Log Tab Component ─────────────────────────────────────────────────

function AuditLogTab() {
  const t = useTranslations("AuditLog");

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>(AUDIT_CATEGORY_ALL);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  const fetchAuditLogs = useCallback(async (category: string, cursor: string | null) => {
    let url = "/api/admin/analytics?type=audit";

    if (category !== AUDIT_CATEGORY_ALL) {
      url = url + `&category=${category}`;
    }

    if (cursor) {
      url = url + `&cursor=${cursor}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data: AuditLogResponse = await response.json();
    return data;
  }, []);

  const loadInitial = useCallback(async (category: string) => {
    setIsLoading(true);
    setEntries([]);
    setNextCursor(null);
    setHasMore(false);

    try {
      const result = await fetchAuditLogs(category, null);
      if (result) {
        setEntries([...result.entries]);
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
      }
    } catch {
      // Audit log fetch failed silently
    } finally {
      setIsLoading(false);
    }
  }, [fetchAuditLogs]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const result = await fetchAuditLogs(activeCategory, nextCursor);
      if (result) {
        setEntries((previous) => [...previous, ...result.entries]);
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
      }
    } catch {
      // Load more failed silently
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeCategory, nextCursor, isLoadingMore, fetchAuditLogs]);

  useEffect(() => {
    loadInitial(activeCategory);
  }, [activeCategory, loadInitial]);

  function handleCategoryChange(category: string) {
    setActiveCategory(category);
  }

  return (
    <div className="space-y-4">
      {/* Category Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {AUDIT_CATEGORIES.map((category) => {
          const isActive = category === activeCategory;
          const translationKey = CATEGORY_TRANSLATION_KEYS[category];
          let pillClassName = "rounded-full px-3 py-1.5 text-sm font-medium transition-colors ";
          if (isActive) {
            pillClassName = pillClassName + "bg-blue-600 text-white";
          } else {
            pillClassName = pillClassName + "bg-gray-100 text-gray-700 hover:bg-gray-200";
          }
          return (
            <button
              key={category}
              onClick={() => handleCategoryChange(category)}
              className={pillClassName}
            >
              {t(translationKey)}
            </button>
          );
        })}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">{t("loading")}</span>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && entries.length === 0 && (
        <div className="rounded-lg border bg-white p-12 text-center">
          <Inbox className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-sm text-gray-500">{t("emptyState")}</p>
        </div>
      )}

      {/* Table */}
      {!isLoading && entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-700">{t("columnTime")}</th>
                <th className="px-4 py-3 font-medium text-gray-700">{t("columnCategory")}</th>
                <th className="px-4 py-3 font-medium text-gray-700">{t("columnAction")}</th>
                <th className="px-4 py-3 font-medium text-gray-700">{t("columnActor")}</th>
                <th className="px-4 py-3 font-medium text-gray-700">{t("columnSummary")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => {
                const badgeColor = CATEGORY_BADGE_COLORS[entry.category];
                const defaultBadgeColor = "bg-gray-100 text-gray-800";
                let resolvedBadgeColor: string;
                if (badgeColor) {
                  resolvedBadgeColor = badgeColor;
                } else {
                  resolvedBadgeColor = defaultBadgeColor;
                }
                const categoryKey = CATEGORY_TRANSLATION_KEYS[entry.category];
                let categoryLabel: string;
                if (categoryKey) {
                  categoryLabel = t(categoryKey);
                } else {
                  categoryLabel = entry.category;
                }
                const formattedTime = new Date(entry.createdAt).toLocaleString();
                const actorName = resolveActorName(entry, t("systemActor"));
                const summary = buildSummary(entry, t);

                return (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {formattedTime}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${resolvedBadgeColor}`}>
                        {categoryLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-900">{entry.action}</td>
                    <td className="px-4 py-3 text-gray-600">{actorName}</td>
                    <td className="px-4 py-3 text-gray-600">{summary}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Load More Button */}
      {!isLoading && hasMore && (
        <div className="flex justify-center pt-4">
          <button
            onClick={loadMore}
            disabled={isLoadingMore}
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isLoadingMore && (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("loading")}
              </span>
            )}
            {!isLoadingMore && t("loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
