import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { moderateReview } from "@/lib/services/review-platform-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { source, action, locationId, reviewId, reasonAbuse, response: reviewResponse, respondentEmail } = body;

  if (!source || !action || !locationId || !reviewId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const token = source === "kv" ? process.env.KV_API_TOKEN : process.env.KIYOH_API_TOKEN;

  if (!token) {
    return NextResponse.json({ error: "API token not configured" }, { status: 500 });
  }

  try {
    const result = await moderateReview(
      source as "kiyoh" | "kv",
      action,
      token,
      {
        locationId,
        reviewId,
        reasonAbuse,
        response: reviewResponse,
        respondentEmail,
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.statusCode }
      );
    }

    return NextResponse.json({ success: true, action: result.action });
  } catch (error) {
    console.error("Moderation error:", error);
    return NextResponse.json({ error: "Moderation request failed" }, { status: 500 });
  }
}
