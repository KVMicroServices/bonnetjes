export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import {
  getNotifications,
  getUnreadCount,
  markAllAsRead,
} from "@/lib/services/notification-service";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");

    if (type === "count") {
      const count = await getUnreadCount(userId);
      return NextResponse.json({ count });
    }

    const notifications = await getNotifications();

    return NextResponse.json({ notifications });
  } catch (error) {
    logger.error({ error }, "Notifications GET error");
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;

    if (payload.action === "mark_all_read") {
      await markAllAsRead(userId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    logger.error({ error }, "Notifications POST error");
    return NextResponse.json({ error: "Failed to process notification action" }, { status: 500 });
  }
}
