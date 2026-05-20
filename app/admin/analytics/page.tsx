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
  FileText,
  Loader2,
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
}

type TabId = "metrics" | "volume" | "audit";
type Granularity = "hour" | "day" | "week";

// ─── Component ───────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("Analytics");

  const [activeTab, setActiveTab] = useState<TabId>("metrics");
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
  const [volumeData, setVolumeData] = useState<ReadonlyArray<VolumeDataPoint>>([]);
  const [granularity, setGranularity] = useState<Granularity>("day");
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
      const response = await fetch(`/api/admin/analytics?type=volume&granularity=${granularity}`);
      if (response.ok) {
        const data = await response.json();
        setVolumeData(data.data);
      }
    } catch {
      // Volume fetch failed silently
    } finally {
      setLoadingVolume(false);
    }
  }, [granularity]);

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
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
        active
          ? "border-blue-500 text-blue-600"
          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
      }`}
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
}: {
  data: ReadonlyArray<VolumeDataPoint>;
  loading: boolean;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
}) {
  const t = useTranslations("Analytics");

  return (
    <div className="space-y-4">
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

      {/* Chart */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : data.length === 0 ? (
          <div className="py-16 text-center text-gray-500">{t("noData")}</div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={data as VolumeDataPoint[]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
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
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-blue-100 text-blue-700"
          : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Audit Log Tab ───────────────────────────────────────────────────────────

function AuditLogTab() {
  const t = useTranslations("Analytics");

  return (
    <div className="rounded-lg border bg-white p-12 text-center">
      <FileText className="mx-auto h-12 w-12 text-gray-300" />
      <h3 className="mt-4 text-lg font-medium text-gray-900">
        {t("auditLogTitle")}
      </h3>
      <p className="mt-2 text-sm text-gray-500">
        {t("auditLogDescription")}
      </p>
    </div>
  );
}
