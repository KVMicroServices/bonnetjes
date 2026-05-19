import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchNotificationCount } from "@/lib/services/review-platform-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = {
    kiyohToken: process.env.KIYOH_API_TOKEN,
    kvToken: process.env.KV_API_TOKEN,
  };

  if (!tokens.kiyohToken && !tokens.kvToken) {
    return NextResponse.json({ count: 0 });
  }

  try {
    const result = await fetchNotificationCount(tokens);

    if (!result.success) {
      return NextResponse.json({ count: 0 });
    }

    return NextResponse.json({
      count: result.data.count,
      updatedLocations: result.data.updatedLocations,
    });
  } catch (error) {
    console.error("Review notifications error:", error);
    return NextResponse.json({ count: 0 });
  }
}
