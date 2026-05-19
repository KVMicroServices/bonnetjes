export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchPendingReviews } from "@/lib/services/review-platform-service";

// Server-side memory cache — 10 minute TTL
let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";
  const loadAll = searchParams.get("all") === "1";

  const now = Date.now();
  if (!force && cache && now - cache.ts < CACHE_TTL) {
    return NextResponse.json({ ...cache.data, fromCache: true });
  }

  const tokens = {
    kiyohToken: process.env.KIYOH_API_TOKEN,
    kvToken: process.env.KV_API_TOKEN,
  };

  if (!tokens.kiyohToken && !tokens.kvToken) {
    return NextResponse.json({ error: "No API tokens configured" }, { status: 500 });
  }

  const result = await fetchPendingReviews(tokens, { loadAll });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const data = {
    reviews: result.data.reviews,
    total: result.data.total,
    locationCount: result.data.locationCount,
    locationsChecked: result.data.locationsChecked,
    loadedAll: result.data.loadedAll,
    fromCache: false,
  };

  if (!loadAll) {
    cache = { data, ts: now };
  }

  return NextResponse.json(data);
}
