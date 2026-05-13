import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchReviewsForLocation } from "@/lib/services/review-platform-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { locationId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const source = (searchParams.get("source") || "kiyoh") as "kiyoh" | "kv";
  const orderBy = searchParams.get("orderBy") || "CREATE_DATE";
  const sortOrder = searchParams.get("sortOrder") || "DESC";
  const limit = searchParams.get("limit") || "25";

  const token = source === "kv" ? process.env.KV_API_TOKEN : process.env.KIYOH_API_TOKEN;

  if (!token) {
    return NextResponse.json({ error: "API token not configured" }, { status: 500 });
  }

  try {
    const result = await fetchReviewsForLocation(
      source,
      params.locationId,
      token,
      { orderBy, sortOrder, limit }
    );

    if (!result.success) {
      return NextResponse.json({ reviews: [], total: 0, error: result.error });
    }

    return NextResponse.json({ reviews: result.reviews, total: result.total });
  } catch (error) {
    console.error("Reviews fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch reviews", reviews: [], total: 0 });
  }
}
