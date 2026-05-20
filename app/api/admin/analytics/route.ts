export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import {
  getAnalyticsMetrics,
  getReceiptVolume,
  VolumeGranularity,
} from "@/lib/services/analytics-service";

const VALID_GRANULARITIES: ReadonlyArray<string> = ["hour", "day", "week"];

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

    if (type === "volume") {
      const granularity = searchParams.get("granularity") || "day";
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
    console.error("Analytics API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
