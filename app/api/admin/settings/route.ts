export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import {
  getFeatureToggles,
  setSettingBoolean,
  SETTING_AUTO_VERIFY_ENABLED,
  SETTING_AUTO_DISABLE_ENABLED,
} from "@/lib/services/app-settings-service";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const toggles = await getFeatureToggles();
    return NextResponse.json(toggles);
  } catch (error) {
    logger.error({ error }, "Failed to fetch app settings");
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = (session.user as any).role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

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

    if ("autoVerifyEnabled" in payload) {
      if (typeof payload.autoVerifyEnabled !== "boolean") {
        return NextResponse.json({ error: "autoVerifyEnabled must be a boolean" }, { status: 400 });
      }
      await setSettingBoolean(SETTING_AUTO_VERIFY_ENABLED, payload.autoVerifyEnabled);
    }

    if ("autoDisableEnabled" in payload) {
      if (typeof payload.autoDisableEnabled !== "boolean") {
        return NextResponse.json({ error: "autoDisableEnabled must be a boolean" }, { status: 400 });
      }
      await setSettingBoolean(SETTING_AUTO_DISABLE_ENABLED, payload.autoDisableEnabled);
    }

    const toggles = await getFeatureToggles();
    logger.info({ toggles, admin: session.user.email }, "App settings updated");
    return NextResponse.json(toggles);
  } catch (error) {
    logger.error({ error }, "Failed to update app settings");
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
