export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import {
  getAppSettings,
  setSettingBoolean,
  setSettingInteger,
  SETTING_AUTO_VERIFY_ENABLED,
  SETTING_AUTO_DISABLE_ENABLED,
  SETTING_HIGH_CONFIDENCE_THRESHOLD,
  SETTING_LOW_CONFIDENCE_THRESHOLD,
} from "@/lib/services/app-settings-service";

const MIN_THRESHOLD = 0;
const MAX_THRESHOLD = 100;

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

    const settings = await getAppSettings();
    return NextResponse.json(settings);
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

    if ("highConfidenceThreshold" in payload) {
      if (typeof payload.highConfidenceThreshold !== "number") {
        return NextResponse.json({ error: "highConfidenceThreshold must be a number" }, { status: 400 });
      }
      if (payload.highConfidenceThreshold < MIN_THRESHOLD || payload.highConfidenceThreshold > MAX_THRESHOLD) {
        return NextResponse.json({ error: "highConfidenceThreshold must be between 0 and 100" }, { status: 400 });
      }
      await setSettingInteger(SETTING_HIGH_CONFIDENCE_THRESHOLD, payload.highConfidenceThreshold);
    }

    if ("lowConfidenceThreshold" in payload) {
      if (typeof payload.lowConfidenceThreshold !== "number") {
        return NextResponse.json({ error: "lowConfidenceThreshold must be a number" }, { status: 400 });
      }
      if (payload.lowConfidenceThreshold < MIN_THRESHOLD || payload.lowConfidenceThreshold > MAX_THRESHOLD) {
        return NextResponse.json({ error: "lowConfidenceThreshold must be between 0 and 100" }, { status: 400 });
      }
      await setSettingInteger(SETTING_LOW_CONFIDENCE_THRESHOLD, payload.lowConfidenceThreshold);
    }

    const settings = await getAppSettings();
    logger.info({ settings, admin: session.user.email }, "App settings updated");
    return NextResponse.json(settings);
  } catch (error) {
    logger.error({ error }, "Failed to update app settings");
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
