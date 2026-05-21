"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { Header } from "@/components/header";
import {
  Shield,
  Receipt,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Filter,
  Loader2,
  Copy,
  Download,
  Eye,
  Check,
  X as XIcon,
  Calendar,
  DollarSign,
  User,
  FileText,
  ChevronLeft,
  ChevronRight,
  Mail,
  CloudDownload,
  Power,
  Scale,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import { CommentThread } from "@/components/comment-thread";
import { clientLogger } from "@/lib/client-logger";

const REJECTION_EMAIL_TEMPLATE = `Beste heer/mevrouw,

Wij hebben onlangs een beoordeling van u ontvangen voor het bedrijf via ons platform, waarvoor hartelijk dank. Omdat u niet via een uitnodigingsmail of link van een bedrijf uw beoordeling plaatst, verifiëren wij de bonnen zodat we uw waardevolle beoordeling tussen andere waardevolle beoordelingen van een bedrijf.

Klantenvertellen en Kiyoh zijn omgevingen waar klanten van organisaties beoordelingen achter kunnen laten, om op deze manier toekomstige klanten te ondersteunen in de keuze.

Bij het invullen van uw beoordeling heeft u een bewijs geüpload van uw ervaring met het bedrijf. Echter voldoet deze niet aan de gestelde voorwaarden. Zou u ons een bewijs kunnen terugmailen dat u een ervaring heeft gehad met het bedrijf van de afgelopen zes maanden.

Wat accepteren we als aankoopbewijs?
• Factuur/Kassabon/Retourbon/Bankoverboeking
• Opdrachtbevestiging mits ondertekend door zowel het bedrijf als u

Wat controleren we als aankoopbewijs?
• Bedrijfsnaam
• Plaatsnaam
• Datum (binnen zes maanden, tenzij u door het bedrijf bent uitgenodigd recentelijk)
• Factuur- en/of relatie- klantnummer

Indien wij geen juiste klantbewijs mogen ontvangen, kunnen wij uw beoordeling niet opnemen in de resultaten.

Klantenvertellen en Kiyoh opereren als onafhankelijke review partijen, deze onafhankelijkheid is belangrijk voor ons. Hoe we hiermee omgaan, leest u op onze website. Deze controle doen we conform de nieuwe wetgeving die op 28 mei 2022 is ingegaan. Wij gebruiken de aangeleverde persoonsgegevens dan ook uitsluitend om een verzoek uit te sturen om een review te plaatsen. Vervolgens vernietigen wij de aan klantenvertellen verstrekte persoonsgegevens.

Wij horen graag van u.

Met vriendelijke groet, With kind regards,

Deniz, Review adviseur`;

// ─── Confidence Display Helpers ───────────────────────────────────────────────

const CONFIDENCE_HIGH_THRESHOLD = 80;
const CONFIDENCE_MEDIUM_THRESHOLD = 50;
const POLLING_INTERVAL_MS = 15000;
const REVIEW_REQUIRED_PAGE_SIZE = 10;
const DISPUTES_PAGE_SIZE = 20;
const FRAUD_HIGH_THRESHOLD = 50;
const FRAUD_MEDIUM_THRESHOLD = 30;

function getFraudRiskColorClass(score: number | null | undefined): string {
  const value = score ?? 0;
  if (value >= FRAUD_HIGH_THRESHOLD) {
    return "text-red-600";
  }
  if (value >= FRAUD_MEDIUM_THRESHOLD) {
    return "text-orange-600";
  }
  return "text-green-600";
}

function getConfidenceColorClass(confidence: number | null | undefined): string {
  const value = confidence ?? 0;
  if (value >= CONFIDENCE_HIGH_THRESHOLD) {
    return "text-green-600";
  }
  if (value >= CONFIDENCE_MEDIUM_THRESHOLD) {
    return "text-orange-600";
  }
  return "text-red-600";
}

function formatConfidenceDisplay(confidence: number | null | undefined): string {
  if (confidence != null) {
    return `${confidence}%`;
  }
  return "N/A";
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminStats {
  totalReceipts: number;
  pendingCount: number;
  verifiedCount: number;
  rejectedCount: number;
  totalUsers: number;
  fraudStats: {
    averageRiskScore: number;
    duplicateCount: number;
    highRiskCount: number;
  };
  recentActions: Array<{
    id: string;
    action: string;
    createdAt: string;
    admin: { name: string; email: string };
    receipt: { id: string; extractedShopName: string | null };
  }>;
}

interface ReceiptData {
  id: string;
  originalFilename: string;
  cloudStoragePath: string;
  extractedShopName: string | null;
  extractedDate: string | null;
  extractedAmount: number | null;
  verificationStatus: string;
  ocrConfidence: number | null;
  ocrReasoning: string | null;
  failureReason: string | null;
  secondaryAnalysis: string | null;
  fraudRiskScore: number | null;
  isDuplicate: boolean;
  manipulationScore: number | null;
  manipulationFlags: string | null;
  suspiciousPatterns: string | null;
  receiptReadable: boolean | null;
  createdAt: string;
  queuedAt: string | null;
  processedAt: string | null;
  user: { id: string; name: string | null; email: string };
}

interface DisputeData {
  id: string;
  reviewId: string;
  tenantId: number | null;
  locationId: string | null;
  receiptId: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  receipt: ReceiptData | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { data: session, status } = useSession() || {};
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("Admin");

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"queue" | "disputes" | "manual-disable">("queue");
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disablingReviewId, setDisablingReviewId] = useState<string | null>(null);
  const [reviewDisabledReceipts, setReviewDisabledReceipts] = useState<Set<string>>(new Set());

  // Manual disable form state
  const [manualReviewId, setManualReviewId] = useState("");
  const [manualLocationId, setManualLocationId] = useState("");
  const [manualTenantId, setManualTenantId] = useState("");
  const [manualDisableLoading, setManualDisableLoading] = useState(false);

  // Review-required list state
  const [reviewRequiredReceipts, setReviewRequiredReceipts] = useState<ReceiptData[]>([]);
  const [reviewRequiredCursor, setReviewRequiredCursor] = useState<string | null>(null);
  const reviewRequiredCursorRef = useRef<string | null>(null);
  const [reviewRequiredHasMore, setReviewRequiredHasMore] = useState(false);
  const [reviewRequiredLoading, setReviewRequiredLoading] = useState(false);
  const [reviewTimeRange, setReviewTimeRange] = useState<string>("all");

  // Disputes tab state
  const [disputes, setDisputes] = useState<DisputeData[]>([]);
  const [disputesCursor, setDisputesCursor] = useState<string | null>(null);
  const [disputesHasMore, setDisputesHasMore] = useState(false);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [disputeTimeRange, setDisputeTimeRange] = useState<string>("all");
  const [selectedDispute, setSelectedDispute] = useState<DisputeData | null>(null);
  const [disputePreviewUrl, setDisputePreviewUrl] = useState<string | null>(null);
  const [disputePreviewLoading, setDisputePreviewLoading] = useState(false);
  const [updatingDisputeId, setUpdatingDisputeId] = useState<string | null>(null);

  const isAdmin = (session?.user as any)?.role === "admin";

  // ─── Time Range Helpers ──────────────────────────────────────────────────────

  function getTimeRangeParams(range: string): { from?: string; to?: string } {
    if (range === "all") {
      return {};
    }
    const now = new Date();
    const from = new Date();
    if (range === "24h") {
      from.setHours(now.getHours() - 24);
    } else if (range === "7d") {
      from.setDate(now.getDate() - 7);
    } else if (range === "30d") {
      from.setDate(now.getDate() - 30);
    } else if (range === "90d") {
      from.setDate(now.getDate() - 90);
    }
    return { from: from.toISOString(), to: now.toISOString() };
  }

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(REJECTION_EMAIL_TEMPLATE);
    toast({
      title: t("copied"),
      description: t("copiedDescription")
    });
  };

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/admin/receipt-sync/trigger", { method: "POST" });
      toast({
        title: t("syncTriggered"),
        description: t("syncTriggeredDescription")
      });
    } catch {
      // silent fail
    } finally {
      setSyncing(false);
    }
  };

  const handleManualDisable = async (action: "disable-manual" | "enable-manual") => {
    const trimmedReviewId = manualReviewId.trim();
    const trimmedLocationId = manualLocationId.trim();
    const parsedTenantId = parseInt(manualTenantId.trim(), 10);

    if (!trimmedReviewId || !trimmedLocationId || isNaN(parsedTenantId) || parsedTenantId <= 0) {
      toast({
        title: t("manualDisableValidationError"),
        description: t("manualDisableValidationDescription"),
        variant: "destructive",
      });
      return;
    }

    setManualDisableLoading(true);
    try {
      const response = await fetch("/api/admin/reviews/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewId: trimmedReviewId,
          locationId: trimmedLocationId,
          tenantId: parsedTenantId,
        }),
      });
      const data = await response.json();
      if (data.success) {
        const isDisable = action === "disable-manual";
        toast({
          title: t("reviewToggled"),
          description: isDisable ? t("reviewDisabled") : t("reviewEnabled"),
        });
        setManualReviewId("");
        setManualLocationId("");
        setManualTenantId("");
      } else {
        toast({
          title: t("reviewToggleFailed"),
          description: data.error || t("reviewToggleFailedDescription"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("reviewToggleFailed"),
        description: t("reviewToggleFailedDescription"),
        variant: "destructive",
      });
    } finally {
      setManualDisableLoading(false);
    }
  };

  const handleToggleReview = async (receiptId: string) => {
    setDisablingReviewId(receiptId);
    const isCurrentlyDisabled = reviewDisabledReceipts.has(receiptId);
    const action = isCurrentlyDisabled ? "enable" : "disable";

    try {
      const response = await fetch("/api/admin/reviews/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, receiptId }),
      });
      const data = await response.json();
      if (data.success) {
        setReviewDisabledReceipts(prev => {
          const updated = new Set(prev);
          if (isCurrentlyDisabled) {
            updated.delete(receiptId);
          } else {
            updated.add(receiptId);
          }
          return updated;
        });
        toast({
          title: t("reviewToggled"),
          description: isCurrentlyDisabled ? t("reviewEnabled") : t("reviewDisabled")
        });
      } else {
        toast({
          title: t("reviewToggleFailed"),
          description: data.error || t("reviewToggleFailedDescription"),
          variant: "destructive"
        });
      }
    } catch {
      toast({
        title: t("reviewToggleFailed"),
        description: t("reviewToggleFailedDescription"),
        variant: "destructive"
      });
    } finally {
      setDisablingReviewId(null);
    }
  };

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, receiptsRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/receipts")
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (receiptsRes.ok) {
        const receiptsData = await receiptsRes.json();
        const receiptsList = Array.isArray(receiptsData)
          ? receiptsData
          : receiptsData.receipts;
        setReceipts(receiptsList || []);
      }
    } catch (error) {
      clientLogger.error({ error }, "Failed to fetch admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchReviewRequired = useCallback(async (reset: boolean = false) => {
    setReviewRequiredLoading(true);
    try {
      const timeParams = getTimeRangeParams(reviewTimeRange);
      const params = new URLSearchParams();
      params.set("status", "requires_review");
      params.set("limit", String(REVIEW_REQUIRED_PAGE_SIZE));
      if (timeParams.from) {
        params.set("from", timeParams.from);
      }
      if (timeParams.to) {
        params.set("to", timeParams.to);
      }
      if (!reset && reviewRequiredCursorRef.current) {
        params.set("cursor", reviewRequiredCursorRef.current);
      }

      const response = await fetch(`/api/admin/receipts/review-required?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        if (reset) {
          setReviewRequiredReceipts(data.receipts);
        } else {
          setReviewRequiredReceipts(prev => [...prev, ...data.receipts]);
        }
        reviewRequiredCursorRef.current = data.nextCursor;
        setReviewRequiredCursor(data.nextCursor);
        setReviewRequiredHasMore(data.hasMore);
      }
    } catch (error) {
      clientLogger.error({ error }, "Failed to fetch review-required receipts");
    } finally {
      setReviewRequiredLoading(false);
    }
  }, [reviewTimeRange]);

  const fetchDisputes = useCallback(async (reset: boolean = false) => {
    setDisputesLoading(true);
    try {
      const timeParams = getTimeRangeParams(disputeTimeRange);
      const params = new URLSearchParams();
      params.set("limit", String(DISPUTES_PAGE_SIZE));
      if (timeParams.from) {
        params.set("from", timeParams.from);
      }
      if (timeParams.to) {
        params.set("to", timeParams.to);
      }
      if (!reset && disputesCursor) {
        params.set("cursor", disputesCursor);
      }

      const response = await fetch(`/api/admin/disputes?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        if (reset) {
          setDisputes(data.disputes);
        } else {
          setDisputes(prev => [...prev, ...data.disputes]);
        }
        setDisputesCursor(data.nextCursor);
        setDisputesHasMore(data.hasMore);
      }
    } catch (error) {
      clientLogger.error({ error }, "Failed to fetch disputes");
    } finally {
      setDisputesLoading(false);
    }
  }, [disputeTimeRange, disputesCursor]);

  const handleDisputeAction = async (disputeId: string, action: "accept" | "reject") => {
    setUpdatingDisputeId(disputeId);
    try {
      const response = await fetch("/api/admin/disputes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId, action }),
      });

      if (response.ok) {
        const newStatus = action === "accept" ? "verified" : "rejected";
        setDisputes(prev =>
          prev.map(dispute => {
            if (dispute.id === disputeId) {
              return { ...dispute, status: newStatus };
            }
            return dispute;
          })
        );
        toast({
          title: t("statusUpdated"),
          description: t("disputeActionSuccess", { action })
        });
        if (selectedDispute?.id === disputeId) {
          setSelectedDispute(prev => prev ? { ...prev, status: newStatus } : null);
        }
      } else {
        toast({
          title: t("failedToUpdate"),
          description: t("disputeActionFailed"),
          variant: "destructive"
        });
      }
    } catch {
      toast({
        title: t("failedToUpdate"),
        description: t("disputeActionFailed"),
        variant: "destructive"
      });
    } finally {
      setUpdatingDisputeId(null);
    }
  };

  // ─── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated") {
      fetchData();
      fetchReviewRequired(true);
    }
  }, [status, router, fetchData, fetchReviewRequired]);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }
    const intervalId = setInterval(() => {
      fetchData();
    }, POLLING_INTERVAL_MS);
    return () => {
      clearInterval(intervalId);
    };
  }, [status, fetchData]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status === "authenticated") {
      setReviewRequiredCursor(null);
      reviewRequiredCursorRef.current = null;
      fetchReviewRequired(true);
    }
  }, [reviewTimeRange]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status === "authenticated" && activeTab === "disputes") {
      setDisputesCursor(null);
      fetchDisputes(true);
    }
  }, [activeTab, disputeTimeRange]);

  // ─── Receipt Preview Handlers ────────────────────────────────────────────────

  const handleViewReceipt = async (receipt: ReceiptData) => {
    setSelectedReceipt(receipt);
    setLoadingPreview(true);
    try {
      const response = await fetch(`/api/receipts/${receipt.id}/download`);
      if (response.ok) {
        const { downloadUrl } = await response.json();
        setPreviewUrl(downloadUrl);
      }
    } catch (error) {
      clientLogger.error({ error }, "Failed to load preview");
      toast({
        title: "Error",
        description: t("failedToLoad"),
        variant: "destructive"
      });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleClosePreview = () => {
    setSelectedReceipt(null);
    setPreviewUrl(null);
  };

  const handleViewDispute = async (dispute: DisputeData) => {
    setSelectedDispute(dispute);
    if (!dispute.receipt) {
      return;
    }
    setDisputePreviewLoading(true);
    try {
      const response = await fetch(`/api/receipts/${dispute.receipt.id}/download`);
      if (response.ok) {
        const { downloadUrl } = await response.json();
        setDisputePreviewUrl(downloadUrl);
      }
    } catch (error) {
      clientLogger.error({ error }, "Failed to load dispute preview");
    } finally {
      setDisputePreviewLoading(false);
    }
  };

  const handleCloseDisputePreview = () => {
    setSelectedDispute(null);
    setDisputePreviewUrl(null);
  };

  const handleStatusUpdate = async (receiptId: string, newStatus: string) => {
    setUpdatingId(receiptId);
    try {
      const response = await fetch(`/api/receipts/${receiptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationStatus: newStatus })
      });

      if (response.ok) {
        toast({
          title: t("statusUpdated"),
          description: t("statusUpdatedDescription", { status: newStatus })
        });
        fetchData();
        fetchReviewRequired(true);
        if (selectedReceipt?.id === receiptId) {
          setSelectedReceipt(prev => prev ? { ...prev, verificationStatus: newStatus } : null);
        }
      }
    } catch (error) {
      clientLogger.error({ error }, "Failed to update receipt");
      toast({
        title: "Error",
        description: t("failedToUpdate"),
        variant: "destructive"
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDownload = async (receipt: ReceiptData) => {
    try {
      const response = await fetch(`/api/receipts/${receipt.id}/download`);
      if (response.ok) {
        const { downloadUrl, filename } = await response.json();
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = filename || "receipt";
        anchor.click();
      }
    } catch (error) {
      clientLogger.error({ error }, "Download error");
    }
  };

  const navigateReceipt = (direction: "prev" | "next") => {
    if (!selectedReceipt) return;
    const currentIndex = filteredReceipts.findIndex(r => r.id === selectedReceipt.id);
    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < filteredReceipts.length) {
      handleViewReceipt(filteredReceipts[newIndex]);
    }
  };

  // ─── Loading / Auth Guards ───────────────────────────────────────────────────

  if (status === "loading" || (status === "authenticated" && loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-kv-green" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  // ─── Derived State ─────────────────────────────────────────────────────────

  const filteredReceipts = (receipts ?? []).filter((r) => {
    if (filter === "all") return true;
    if (filter === "rejected") {
      return r?.verificationStatus === "rejected" || r?.verificationStatus === "flagged";
    }
    return r?.verificationStatus === filter;
  });

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const formatFailureReason = (reason: string | null) => {
    if (!reason) {
      return "—";
    }
    return reason.replace(/_/g, " ");
  };

  const getStatusBadge = (receiptStatus: string) => {
    switch (receiptStatus) {
      case "verified":
        return "bg-green-100 text-green-700";
      case "rejected":
        return "bg-red-100 text-red-700";
      case "flagged":
        return "bg-orange-100 text-orange-700";
      case "requires_review":
        return "bg-blue-100 text-blue-700";
      default:
        return "bg-yellow-100 text-yellow-700";
    }
  };

  const getStatusIcon = (receiptStatus: string) => {
    switch (receiptStatus) {
      case "verified":
        return <CheckCircle className="h-4 w-4" />;
      case "rejected":
        return <XCircle className="h-4 w-4" />;
      case "flagged":
        return <AlertTriangle className="h-4 w-4" />;
      case "requires_review":
        return <Eye className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const currentIndex = selectedReceipt ? filteredReceipts.findIndex(r => r.id === selectedReceipt.id) : -1;
  const isPdf = selectedReceipt?.originalFilename?.toLowerCase().endsWith(".pdf");
  const isDisputePdf = selectedDispute?.receipt?.originalFilename?.toLowerCase().endsWith(".pdf");

  // ─── Time Range Filter Component ────────────────────────────────────────────

  const TimeRangeFilter = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-gray-500" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
      >
        <option value="all">{t("timeRangeAll")}</option>
        <option value="24h">{t("timeRange24h")}</option>
        <option value="7d">{t("timeRange7d")}</option>
        <option value="30d">{t("timeRange30d")}</option>
        <option value="90d">{t("timeRange90d")}</option>
      </select>
    </div>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-kv-green/10 p-3">
              <Shield className="h-6 w-6 text-kv-green" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
              <p className="text-gray-600">{t("subtitle")}</p>
            </div>
          </div>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <CloudDownload className={`h-4 w-4 ${syncing ? "animate-pulse" : ""}`} />
            {t("syncNow")}
          </button>
        </div>

        {/* Human Review Required Section */}
        <div className="mb-8 rounded-xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">{t("humanReviewRequired")}</h2>
              {reviewRequiredReceipts.length > 0 && (
                <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-blue-100 px-2 text-xs font-bold text-blue-700">
                  {reviewRequiredReceipts.length}{reviewRequiredHasMore ? "+" : ""}
                </span>
              )}
            </div>
            <TimeRangeFilter value={reviewTimeRange} onChange={setReviewTimeRange} />
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {reviewRequiredLoading && reviewRequiredReceipts.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : reviewRequiredReceipts.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle className="mx-auto mb-3 h-10 w-10 text-green-400" />
                <p className="text-sm font-medium text-gray-700">{t("noReviewRequired")}</p>
                <p className="text-xs text-gray-500">{t("noReviewRequiredDescription")}</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("receipt")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("queuedAt")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("confidence")}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("failureReason")}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reviewRequiredReceipts.map((receipt) => (
                    <tr key={receipt.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleViewReceipt(receipt)}
                          className="flex items-center gap-2 text-left hover:text-kv-green"
                        >
                          <div className="rounded-lg bg-blue-50 p-2">
                            <FileText className="h-4 w-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                              {receipt.originalFilename}
                            </p>
                            {receipt.extractedShopName && (
                              <p className="text-xs text-gray-500 truncate max-w-[180px]">
                                {receipt.extractedShopName}
                              </p>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(receipt.queuedAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-sm font-medium ${getConfidenceColorClass(receipt.ocrConfidence)}`}>
                          {formatConfidenceDisplay(receipt.ocrConfidence)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatFailureReason(receipt.failureReason)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleViewReceipt(receipt)}
                            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                            title={t("viewReceipt")}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleStatusUpdate(receipt.id, "verified")}
                            disabled={updatingId === receipt.id}
                            className="rounded-lg p-2 text-green-600 hover:bg-green-50 disabled:opacity-50"
                            title={t("approve")}
                          >
                            {(() => {
                              if (updatingId === receipt.id) {
                                return <Loader2 className="h-4 w-4 animate-spin" />;
                              }
                              return <Check className="h-4 w-4" />;
                            })()}
                          </button>
                          <button
                            onClick={() => handleStatusUpdate(receipt.id, "rejected")}
                            disabled={updatingId === receipt.id}
                            className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            title={t("reject")}
                          >
                            <XIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {reviewRequiredHasMore && (
              <div className="border-t px-4 py-3 text-center">
                <button
                  onClick={() => fetchReviewRequired(false)}
                  disabled={reviewRequiredLoading}
                  className="text-sm font-medium text-kv-green hover:text-kv-green/80 disabled:opacity-50"
                >
                  {(() => {
                    if (reviewRequiredLoading) {
                      return <Loader2 className="inline h-4 w-4 animate-spin" />;
                    }
                    return t("loadMore");
                  })()}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab("queue")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
              activeTab === "queue"
                ? "bg-kv-green text-white"
                : "bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            <Receipt className="h-4 w-4" />
            {t("reviewQueue")}
            {(stats?.pendingCount ?? 0) > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-kv-orange text-[10px] font-bold text-white">
                {stats?.pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("disputes")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
              activeTab === "disputes"
                ? "bg-kv-green text-white"
                : "bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            <Scale className="h-4 w-4" />
            {t("disputesTab")}
            {disputes.filter((dispute) => dispute.status === "pending" || dispute.status === "requires_review").length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-kv-orange text-[10px] font-bold text-white">
                {disputes.filter((dispute) => dispute.status === "pending" || dispute.status === "requires_review").length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("manual-disable")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
              activeTab === "manual-disable"
                ? "bg-kv-green text-white"
                : "bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            <Power className="h-4 w-4" />
            {t("manualDisableTab")}
          </button>
        </div>

        {activeTab === "queue" && (
          <>
            {/* Filter */}
            <div className="mb-6 flex items-center gap-4">
              <Filter className="h-5 w-5 text-gray-500" />
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "all", label: t("filterAll"), icon: Receipt },
                  { value: "pending", label: t("filterPending"), icon: Clock },
                  { value: "verified", label: t("filterVerified"), icon: CheckCircle },
                  { value: "rejected", label: t("filterRejected"), icon: XCircle }
                ].map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setFilter(item.value)}
                    className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      filter === item.value
                        ? "bg-kv-green/10 text-kv-green/90"
                        : "bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Receipts List Table */}
            {filteredReceipts.length === 0 ? (
              <div className="rounded-xl bg-white p-12 text-center shadow-sm">
                <Receipt className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                <h3 className="mb-2 text-lg font-semibold text-gray-900">
                  {t("noReceipts")}
                </h3>
                <p className="text-gray-600">{t("noReceiptsDescription")}</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("receipt")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("queuedAt")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("processedAt")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("confidence")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("risk")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("failureReason")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("status")}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredReceipts.map((receipt) => (
                      <tr key={receipt.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleViewReceipt(receipt)}
                              className="flex items-center gap-2 text-left hover:text-kv-green"
                            >
                              <div className="rounded-lg bg-gray-100 p-2">
                                <FileText className="h-5 w-5 text-gray-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 truncate max-w-[200px]">
                                  {receipt.originalFilename}
                                </p>
                                {receipt.extractedShopName && (
                                  <p className="text-xs text-gray-500 truncate max-w-[200px]">
                                    {receipt.extractedShopName}
                                  </p>
                                )}
                              </div>
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(receipt.queuedAt)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(receipt.processedAt)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-medium ${getConfidenceColorClass(receipt.ocrConfidence)}`}>
                            {formatConfidenceDisplay(receipt.ocrConfidence)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {receipt.isDuplicate && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                <Copy className="h-3 w-3" />
                                Dup
                              </span>
                            )}
                            <span className={`text-sm font-medium ${getFraudRiskColorClass(receipt.fraudRiskScore)}`}>
                              {receipt.fraudRiskScore ?? 0}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatFailureReason(receipt.failureReason)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${getStatusBadge(receipt.verificationStatus)}`}>
                            {getStatusIcon(receipt.verificationStatus)}
                            {receipt.verificationStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleViewReceipt(receipt)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700" title={t("viewReceipt")}>
                              <Eye className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleDownload(receipt)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700" title={t("download")}>
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleStatusUpdate(receipt.id, "verified")}
                              disabled={updatingId === receipt.id || receipt.verificationStatus === "verified"}
                              className="rounded-lg p-2 text-green-600 hover:bg-green-50 disabled:opacity-50"
                              title={t("approve")}
                            >
                              {(() => {
                                if (updatingId === receipt.id) {
                                  return <Loader2 className="h-4 w-4 animate-spin" />;
                                }
                                return <Check className="h-4 w-4" />;
                              })()}
                            </button>
                            <button
                              onClick={() => handleStatusUpdate(receipt.id, "rejected")}
                              disabled={updatingId === receipt.id || receipt.verificationStatus === "rejected"}
                              className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                              title={t("reject")}
                            >
                              <XIcon className="h-4 w-4" />
                            </button>
                            {receipt.verificationStatus === "rejected" && (
                              <button onClick={() => setShowEmailModal(true)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700" title={t("emailTemplate")}>
                                <Mail className="h-4 w-4" />
                              </button>
                            )}
                            {(receipt.verificationStatus === "rejected" || receipt.verificationStatus === "flagged") && (
                              <button
                                onClick={() => handleToggleReview(receipt.id)}
                                disabled={disablingReviewId === receipt.id}
                                className={`rounded-lg p-2 disabled:opacity-50 ${
                                  (() => {
                                    if (reviewDisabledReceipts.has(receipt.id)) {
                                      return "text-green-600 hover:bg-green-50";
                                    }
                                    return "text-orange-600 hover:bg-orange-50";
                                  })()
                                }`}
                                title={(() => {
                                  if (reviewDisabledReceipts.has(receipt.id)) {
                                    return t("enableReview");
                                  }
                                  return t("disableReview");
                                })()}
                              >
                                {(() => {
                                  if (disablingReviewId === receipt.id) {
                                    return <Loader2 className="h-4 w-4 animate-spin" />;
                                  }
                                  return <Power className="h-4 w-4" />;
                                })()}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === "disputes" && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm text-gray-600">{t("disputesDescription")}</p>
              <TimeRangeFilter value={disputeTimeRange} onChange={setDisputeTimeRange} />
            </div>

            {disputesLoading && disputes.length === 0 ? (
              <div className="flex items-center justify-center rounded-xl bg-white py-16 shadow-sm">
                <Loader2 className="h-8 w-8 animate-spin text-kv-green" />
              </div>
            ) : disputes.length === 0 ? (
              <div className="rounded-xl bg-white p-12 text-center shadow-sm">
                <Scale className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                <h3 className="mb-2 text-lg font-semibold text-gray-900">{t("noDisputes")}</h3>
                <p className="text-gray-600">{t("noDisputesDescription")}</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("receipt")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("disputeReviewId")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("disputeDate")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("confidence")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("failureReason")}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t("status")}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {disputes.map((dispute) => (
                      <tr key={dispute.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleViewDispute(dispute)}
                            className="flex items-center gap-2 text-left hover:text-kv-green"
                          >
                            <div className="rounded-lg bg-purple-50 p-2">
                              <Scale className="h-4 w-4 text-purple-600" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                                {dispute.receipt?.originalFilename || "—"}
                              </p>
                              {dispute.receipt?.extractedShopName && (
                                <p className="text-xs text-gray-500 truncate max-w-[180px]">
                                  {dispute.receipt.extractedShopName}
                                </p>
                              )}
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 font-mono">{dispute.reviewId}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatDate(dispute.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-medium ${getConfidenceColorClass(dispute.receipt?.ocrConfidence)}`}>
                            {formatConfidenceDisplay(dispute.receipt?.ocrConfidence)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formatFailureReason(dispute.failureReason)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${getStatusBadge(dispute.status)}`}>
                            {getStatusIcon(dispute.status)}
                            {dispute.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleViewDispute(dispute)}
                              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                              title={t("viewReceipt")}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDisputeAction(dispute.id, "accept")}
                              disabled={updatingDisputeId === dispute.id || dispute.status === "verified"}
                              className="rounded-lg p-2 text-green-600 hover:bg-green-50 disabled:opacity-50"
                              title={t("disputeAccept")}
                            >
                              {(() => {
                                if (updatingDisputeId === dispute.id) {
                                  return <Loader2 className="h-4 w-4 animate-spin" />;
                                }
                                return <Check className="h-4 w-4" />;
                              })()}
                            </button>
                            <button
                              onClick={() => handleDisputeAction(dispute.id, "reject")}
                              disabled={updatingDisputeId === dispute.id || dispute.status === "rejected"}
                              className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                              title={t("disputeReject")}
                            >
                              <XIcon className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {disputesHasMore && (
                  <div className="border-t px-4 py-3 text-center">
                    <button
                      onClick={() => fetchDisputes(false)}
                      disabled={disputesLoading}
                      className="text-sm font-medium text-kv-green hover:text-kv-green/80 disabled:opacity-50"
                    >
                      {(() => {
                        if (disputesLoading) {
                          return <Loader2 className="inline h-4 w-4 animate-spin" />;
                        }
                        return t("loadMore");
                      })()}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "manual-disable" && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{t("manualDisableTitle")}</h2>
              <p className="text-sm text-gray-600">{t("manualDisableDescription")}</p>
            </div>

            <div className="max-w-md space-y-4">
              <div>
                <label htmlFor="manual-review-id" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("manualDisableReviewIdLabel")}
                </label>
                <input
                  id="manual-review-id"
                  type="text"
                  value={manualReviewId}
                  onChange={(e) => setManualReviewId(e.target.value)}
                  placeholder={t("manualDisableReviewIdPlaceholder")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kv-green focus:outline-none focus:ring-1 focus:ring-kv-green"
                />
              </div>

              <div>
                <label htmlFor="manual-location-id" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("manualDisableLocationIdLabel")}
                </label>
                <input
                  id="manual-location-id"
                  type="text"
                  value={manualLocationId}
                  onChange={(e) => setManualLocationId(e.target.value)}
                  placeholder={t("manualDisableLocationIdPlaceholder")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kv-green focus:outline-none focus:ring-1 focus:ring-kv-green"
                />
              </div>

              <div>
                <label htmlFor="manual-tenant-id" className="block text-sm font-medium text-gray-700 mb-1">
                  {t("manualDisableTenantIdLabel")}
                </label>
                <input
                  id="manual-tenant-id"
                  type="number"
                  value={manualTenantId}
                  onChange={(e) => setManualTenantId(e.target.value)}
                  placeholder={t("manualDisableTenantIdPlaceholder")}
                  min="1"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kv-green focus:outline-none focus:ring-1 focus:ring-kv-green"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleManualDisable("disable-manual")}
                  disabled={manualDisableLoading}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {(() => {
                    if (manualDisableLoading) {
                      return <Loader2 className="h-4 w-4 animate-spin" />;
                    }
                    return <Power className="h-4 w-4" />;
                  })()}
                  {t("manualDisableButton")}
                </button>
                <button
                  onClick={() => handleManualDisable("enable-manual")}
                  disabled={manualDisableLoading}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {(() => {
                    if (manualDisableLoading) {
                      return <Loader2 className="h-4 w-4 animate-spin" />;
                    }
                    return <Power className="h-4 w-4" />;
                  })()}
                  {t("manualEnableButton")}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Receipt Preview Modal */}
      <AnimatePresence>
        {selectedReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={handleClosePreview}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative flex max-h-[90vh] w-full max-w-5xl gap-4 rounded-2xl bg-white p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={handleClosePreview} className="absolute right-4 top-4 z-10 rounded-lg bg-white p-2 text-gray-500 shadow-md hover:bg-gray-100">
                <XIcon className="h-5 w-5" />
              </button>

              {currentIndex > 0 && (
                <button onClick={() => navigateReceipt("prev")} className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white p-2 text-gray-600 shadow-md hover:bg-gray-100">
                  <ChevronLeft className="h-6 w-6" />
                </button>
              )}
              {currentIndex < filteredReceipts.length - 1 && (
                <button onClick={() => navigateReceipt("next")} className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white p-2 text-gray-600 shadow-md hover:bg-gray-100">
                  <ChevronRight className="h-6 w-6" />
                </button>
              )}

              {/* Image Preview */}
              <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden min-h-[500px]">
                {loadingPreview ? (
                  <Loader2 className="h-8 w-8 animate-spin text-kv-green" />
                ) : previewUrl ? (
                  isPdf ? (
                    <iframe src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`} className="w-full h-full min-h-[500px]" title="Receipt PDF" />
                  ) : (
                    <div className="relative w-full h-full min-h-[500px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt="Receipt" className="max-w-full max-h-full object-contain mx-auto" style={{ maxHeight: "500px" }} />
                    </div>
                  )
                ) : (
                  <p className="text-gray-500">{t("failedToLoadPreview")}</p>
                )}
              </div>

              {/* Details Panel */}
              <div className="w-80 flex-shrink-0 overflow-y-auto">
                <h3 className="text-lg font-bold text-gray-900 mb-4">{selectedReceipt.originalFilename}</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Status:</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${getStatusBadge(selectedReceipt.verificationStatus)}`}>
                      {getStatusIcon(selectedReceipt.verificationStatus)}
                      {selectedReceipt.verificationStatus}
                    </span>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500 flex items-center gap-1"><User className="h-3 w-3" /> Submitted by</p>
                    <p className="font-medium text-gray-900">{selectedReceipt.user?.name || selectedReceipt.user?.email}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500 flex items-center gap-1"><Calendar className="h-3 w-3" /> Date</p>
                      <p className="font-medium text-gray-900">{formatDate(selectedReceipt.extractedDate)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500 flex items-center gap-1"><DollarSign className="h-3 w-3" /> Amount</p>
                      <p className="font-medium text-gray-900">
                        {selectedReceipt.extractedAmount != null ? `$${selectedReceipt.extractedAmount.toFixed(2)}` : "N/A"}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500 flex items-center gap-1"><Shield className="h-3 w-3" /> Fraud Risk Score</p>
                    <div className="flex items-center gap-2">
                      <p className={`text-xl font-bold ${getFraudRiskColorClass(selectedReceipt.fraudRiskScore)}`}>
                        {selectedReceipt.fraudRiskScore ?? 0}%
                      </p>
                      {selectedReceipt.isDuplicate && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          <Copy className="h-3 w-3" /> Duplicate
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedReceipt.ocrReasoning && (
                    <div className="rounded-lg bg-blue-50 p-3">
                      <p className="text-xs font-medium text-blue-700 mb-1">{t("aiAnalysis")}</p>
                      <p className="text-sm text-blue-900">{selectedReceipt.ocrReasoning}</p>
                    </div>
                  )}

                  {selectedReceipt.failureReason && (
                    <div className="rounded-lg bg-red-50 p-3">
                      <p className="text-xs font-medium text-red-700 mb-1">{t("failureReason")}</p>
                      <p className="text-sm font-medium text-red-900">{selectedReceipt.failureReason.replace(/_/g, " ")}</p>
                    </div>
                  )}

                  {selectedReceipt.secondaryAnalysis && (
                    <div className="rounded-lg bg-amber-50 p-3">
                      <p className="text-xs font-medium text-amber-700 mb-1">{t("secondaryAnalysis")}</p>
                      <p className="text-sm text-amber-900">{selectedReceipt.secondaryAnalysis}</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-4 border-t">
                    <button
                      onClick={() => handleStatusUpdate(selectedReceipt.id, "verified")}
                      disabled={updatingId === selectedReceipt.id || selectedReceipt.verificationStatus === "verified"}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {(() => {
                        if (updatingId === selectedReceipt.id) {
                          return <Loader2 className="h-4 w-4 animate-spin" />;
                        }
                        return <Check className="h-4 w-4" />;
                      })()}
                      {t("approve")}
                    </button>
                    <button
                      onClick={() => handleStatusUpdate(selectedReceipt.id, "rejected")}
                      disabled={updatingId === selectedReceipt.id || selectedReceipt.verificationStatus === "rejected"}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <XIcon className="h-4 w-4" />
                      {t("reject")}
                    </button>
                  </div>
                  {selectedReceipt.verificationStatus === "rejected" && (
                    <button onClick={() => setShowEmailModal(true)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      <Mail className="h-4 w-4" /> Email
                    </button>
                  )}
                  <button onClick={() => handleDownload(selectedReceipt)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <Download className="h-4 w-4" /> Download
                  </button>

                  {/* Comment Thread */}
                  <div className="pt-4 border-t">
                    <CommentThread
                      receiptId={selectedReceipt.id}
                      currentUserId={(session?.user as any)?.id || ""}
                      isAdmin={isAdmin}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dispute Preview Modal */}
      <AnimatePresence>
        {selectedDispute && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={handleCloseDisputePreview}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative flex max-h-[90vh] w-full max-w-5xl gap-4 rounded-2xl bg-white p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={handleCloseDisputePreview} className="absolute right-4 top-4 z-10 rounded-lg bg-white p-2 text-gray-500 shadow-md hover:bg-gray-100">
                <XIcon className="h-5 w-5" />
              </button>

              {/* Image Preview */}
              <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden min-h-[500px]">
                {disputePreviewLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-kv-green" />
                ) : disputePreviewUrl ? (
                  isDisputePdf ? (
                    <iframe src={`https://docs.google.com/viewer?url=${encodeURIComponent(disputePreviewUrl)}&embedded=true`} className="w-full h-full min-h-[500px]" title="Dispute Receipt PDF" />
                  ) : (
                    <div className="relative w-full h-full min-h-[500px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={disputePreviewUrl} alt="Dispute Receipt" className="max-w-full max-h-full object-contain mx-auto" style={{ maxHeight: "500px" }} />
                    </div>
                  )
                ) : (
                  <p className="text-gray-500">{t("failedToLoadPreview")}</p>
                )}
              </div>

              {/* Details Panel */}
              <div className="w-80 flex-shrink-0 overflow-y-auto">
                <h3 className="text-lg font-bold text-gray-900 mb-4">{t("disputeDetails")}</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Status:</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${getStatusBadge(selectedDispute.status)}`}>
                      {getStatusIcon(selectedDispute.status)}
                      {selectedDispute.status}
                    </span>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">{t("disputeReviewId")}</p>
                    <p className="font-medium text-gray-900 font-mono text-sm">{selectedDispute.reviewId}</p>
                  </div>

                  {selectedDispute.locationId && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">{t("disputeLocationId")}</p>
                      <p className="font-medium text-gray-900 font-mono text-sm">{selectedDispute.locationId}</p>
                    </div>
                  )}

                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500 flex items-center gap-1"><Calendar className="h-3 w-3" /> {t("disputeDate")}</p>
                    <p className="font-medium text-gray-900">{formatDate(selectedDispute.createdAt)}</p>
                  </div>

                  {selectedDispute.receipt && (
                    <>
                      <div className="space-y-2">
                        <div className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">{t("receipt")}</p>
                          <p className="font-medium text-gray-900 text-sm truncate">{selectedDispute.receipt.originalFilename}</p>
                        </div>
                        {selectedDispute.receipt.extractedShopName && (
                          <div className="rounded-lg bg-gray-50 p-3">
                            <p className="text-xs text-gray-500">{t("shop")}</p>
                            <p className="font-medium text-gray-900">{selectedDispute.receipt.extractedShopName}</p>
                          </div>
                        )}
                        <div className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs text-gray-500 flex items-center gap-1"><DollarSign className="h-3 w-3" /> {t("amount")}</p>
                          <p className="font-medium text-gray-900">
                            {selectedDispute.receipt.extractedAmount != null ? `$${selectedDispute.receipt.extractedAmount.toFixed(2)}` : "N/A"}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="text-xs text-gray-500">{t("confidence")}</p>
                        <span className={`text-lg font-bold ${getConfidenceColorClass(selectedDispute.receipt.ocrConfidence)}`}>
                          {formatConfidenceDisplay(selectedDispute.receipt.ocrConfidence)}
                        </span>
                      </div>

                      {selectedDispute.receipt.ocrReasoning && (
                        <div className="rounded-lg bg-blue-50 p-3">
                          <p className="text-xs font-medium text-blue-700 mb-1">{t("aiAnalysis")}</p>
                          <p className="text-sm text-blue-900">{selectedDispute.receipt.ocrReasoning}</p>
                        </div>
                      )}
                    </>
                  )}

                  {selectedDispute.failureReason && (
                    <div className="rounded-lg bg-red-50 p-3">
                      <p className="text-xs font-medium text-red-700 mb-1">{t("failureReason")}</p>
                      <p className="text-sm font-medium text-red-900">{selectedDispute.failureReason.replace(/_/g, " ")}</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-4 border-t">
                    <button
                      onClick={() => handleDisputeAction(selectedDispute.id, "accept")}
                      disabled={updatingDisputeId === selectedDispute.id || selectedDispute.status === "verified"}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {(() => {
                        if (updatingDisputeId === selectedDispute.id) {
                          return <Loader2 className="h-4 w-4 animate-spin" />;
                        }
                        return <Check className="h-4 w-4" />;
                      })()}
                      {t("disputeAccept")}
                    </button>
                    <button
                      onClick={() => handleDisputeAction(selectedDispute.id, "reject")}
                      disabled={updatingDisputeId === selectedDispute.id || selectedDispute.status === "rejected"}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <XIcon className="h-4 w-4" />
                      {t("disputeReject")}
                    </button>
                  </div>

                  {/* Comment Thread */}
                  {selectedDispute.receipt && (
                    <div className="pt-4 border-t">
                      <CommentThread
                        receiptId={selectedDispute.receipt.id}
                        currentUserId={(session?.user as any)?.id || ""}
                        isAdmin={isAdmin}
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Email Template Modal */}
      <AnimatePresence>
        {showEmailModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setShowEmailModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={() => setShowEmailModal(false)} className="absolute right-4 top-4 rounded-lg p-2 text-gray-500 hover:bg-gray-100">
                <XIcon className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-2 mb-2">
                <Mail className="h-5 w-5 text-gray-700" />
                <h3 className="text-lg font-bold text-gray-900">Email Template</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">Copy this template to send to the customer requesting valid proof of purchase</p>

              <div className="rounded-lg bg-gray-50 p-4 max-h-[400px] overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                  {REJECTION_EMAIL_TEMPLATE}
                </pre>
              </div>

              <div className="flex gap-3 mt-6 justify-end">
                <button onClick={() => setShowEmailModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Close
                </button>
                <button onClick={handleCopyEmail} className="flex items-center gap-2 rounded-lg bg-kv-green px-4 py-2 text-sm font-medium text-white hover:bg-kv-green/90">
                  <Copy className="h-4 w-4" /> Copy to Clipboard
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
