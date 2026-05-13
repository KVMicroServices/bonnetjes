export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchLocations } from "@/lib/services/review-platform-service";

// Server-side memory cache — 30 minute TTL
let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Serve from memory cache if fresh
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL) {
    return NextResponse.json({ ...cache.data, fromCache: true });
  }

  const tokenKIYOH = process.env.KIYOH_API_TOKEN;
  const tokenKV = process.env.KV_API_TOKEN;

  const results = await Promise.allSettled([
    tokenKIYOH
      ? fetchLocations("kiyoh", tokenKIYOH)
      : Promise.resolve({ success: true as const, locations: [] as any[] }),
    tokenKV
      ? fetchLocations("kv", tokenKV)
      : Promise.resolve({ success: true as const, locations: [] as any[] }),
  ]);

  const kiyohResult = results[0].status === "fulfilled" ? results[0].value : null;
  const kvResult = results[1].status === "fulfilled" ? results[1].value : null;

  const kiyohLocations = kiyohResult && kiyohResult.success ? kiyohResult.locations : [];
  const kvLocations = kvResult && kvResult.success ? kvResult.locations : [];

  const kiyohError = results[0].status === "rejected"
    ? (results[0].reason as Error).message
    : (kiyohResult && !kiyohResult.success ? kiyohResult.error : null);
  const kvError = results[1].status === "rejected"
    ? (results[1].reason as Error).message
    : (kvResult && !kvResult.success ? kvResult.error : null);

  const data = {
    kiyoh: kiyohLocations,
    kv: kvLocations,
    errors: { kiyoh: kiyohError, kv: kvError },
    fromCache: false,
  };

  cache = { data, ts: now };

  return NextResponse.json(data);
}
