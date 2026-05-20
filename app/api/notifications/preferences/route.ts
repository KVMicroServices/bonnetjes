export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { z } from "zod";
import {
  getUserPreferences,
  updateUserPreference,
  NOTIFICATION_TYPES,
  type NotificationType,
  type NotificationChannel,
} from "@/lib/services/notification-service";

const VALID_CHANNELS: ReadonlyArray<string> = ["none", "in_app", "email"];

const updatePreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES as unknown as [string, ...string[]]),
  channel: z.enum(VALID_CHANNELS as unknown as [string, ...string[]]),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const preferences = await getUserPreferences(userId);

    return NextResponse.json({ preferences });
  } catch (error) {
    logger.error({ error }, "Notification preferences GET error");
    return NextResponse.json({ error: "Failed to fetch preferences" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
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

    const parseResult = updatePreferenceSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { type, channel } = parseResult.data;

    await updateUserPreference(
      userId,
      type as NotificationType,
      channel as NotificationChannel
    );

    const preferences = await getUserPreferences(userId);
    return NextResponse.json({ preferences });
  } catch (error) {
    logger.error({ error }, "Notification preferences PATCH error");
    return NextResponse.json({ error: "Failed to update preference" }, { status: 500 });
  }
}
