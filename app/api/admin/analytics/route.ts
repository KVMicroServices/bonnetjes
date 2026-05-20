export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  getAnalyticsMetrics,
  getReceiptVolume,
  VolumeGranularity,
} from "@/lib/services/analytics-service";
import {
  getAuditLogs,
  AuditCategory,
} from "@/lib/services/audit-log-service";

const VALID_GRANULARITIES: ReadonlyArray<string> = ["hour", "day", "week"];

const VALID_AUDIT_CATEGORIES: ReadonlyArray<string> = [
  "ai_judgement",
  "secondary_analysis",
  "moderation",
  "comment",
  "user_management",
  "settings",
  "system",
];

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");

    if (type === "audit") {
      return await handleAuditQuery(searchParams);
    }

    if (type === "volume") {
      const granularityParam = searchParams.get("granularity");
      let granularity: string;
      if (granularityParam) {
        granularity = granularityParam;
      } else {
        granularity = "day";
      }
      if (!VALID_GRANULARITIES.includes(granularity)) {
        return NextResponse.json(
          { error: "Invalid granularity. Use: hour, day, or week" },
          { status: 400 }
        );
      }

      const result = await getReceiptVolume(
        { database: prisma },
        granularity as VolumeGranularity
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({ data: result.data });
    }

    // Default: return metrics
    const result = await getAnalyticsMetrics({ database: prisma });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json(result.metrics);
  } catch (error) {
    logger.error({ error }, "Analytics API error");
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}

async function handleAuditQuery(
  searchParams: URLSearchParams
): Promise<NextResponse> {
  const categoryParam = searchParams.get("category");
  const cursorParam = searchParams.get("cursor");

  if (categoryParam && !VALID_AUDIT_CATEGORIES.includes(categoryParam)) {
    return NextResponse.json(
      { error: "Invalid category" },
      { status: 400 }
    );
  }

  const queryOptions: {
    category?: AuditCategory;
    cursor?: string;
  } = {};

  if (categoryParam) {
    queryOptions.category = categoryParam as AuditCategory;
  }

  if (cursorParam) {
    queryOptions.cursor = cursorParam;
  }

  const result = await getAuditLogs(queryOptions);

  return NextResponse.json({
    entries: result.entries,
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  });
}
