export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import {
  getAppSettings,
  setSettingBoolean,
  setSettingInteger,
  setSettingString,
  setSettingStringArray,
  SETTING_AUTO_VERIFY_ENABLED,
  SETTING_AUTO_DISABLE_ENABLED,
  SETTING_HIGH_CONFIDENCE_THRESHOLD,
  SETTING_AUTO_DISABLE_LOCATION_WHITELIST,
  SETTING_SMTP_HOST,
  SETTING_SMTP_PORT,
  SETTING_SMTP_USER,
  SETTING_SMTP_PASS,
  SETTING_SMTP_FROM,
} from "@/lib/services/app-settings-service";
import { recordAuditEvent } from "@/lib/services/audit-log-service";

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
    const redactedSettings = {
      ...settings,
      smtp: {
        ...settings.smtp,
        smtpPass: settings.smtp?.smtpPass ? "***" : null,
      },
    };
    return NextResponse.json(redactedSettings);
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

    if ("autoDisableLocationWhitelist" in payload) {
      if (!Array.isArray(payload.autoDisableLocationWhitelist)) {
        return NextResponse.json({ error: "autoDisableLocationWhitelist must be an array" }, { status: 400 });
      }
      const allStrings = payload.autoDisableLocationWhitelist.every(
        (item: unknown) => typeof item === "string" && item.length > 0
      );
      if (!allStrings) {
        return NextResponse.json({ error: "autoDisableLocationWhitelist must contain non-empty strings" }, { status: 400 });
      }
      await setSettingStringArray(SETTING_AUTO_DISABLE_LOCATION_WHITELIST, payload.autoDisableLocationWhitelist as string[]);
    }

    if ("smtpHost" in payload) {
      if (typeof payload.smtpHost !== "string") {
        return NextResponse.json({ error: "smtpHost must be a string" }, { status: 400 });
      }
      await setSettingString(SETTING_SMTP_HOST, payload.smtpHost);
    }

    if ("smtpPort" in payload) {
      if (typeof payload.smtpPort !== "string") {
        return NextResponse.json({ error: "smtpPort must be a string" }, { status: 400 });
      }
      await setSettingString(SETTING_SMTP_PORT, payload.smtpPort);
    }

    if ("smtpUser" in payload) {
      if (typeof payload.smtpUser !== "string") {
        return NextResponse.json({ error: "smtpUser must be a string" }, { status: 400 });
      }
      await setSettingString(SETTING_SMTP_USER, payload.smtpUser);
    }

    if ("smtpPass" in payload) {
      if (typeof payload.smtpPass !== "string") {
        return NextResponse.json({ error: "smtpPass must be a string" }, { status: 400 });
      }
      await setSettingString(SETTING_SMTP_PASS, payload.smtpPass);
    }

    if ("smtpFrom" in payload) {
      if (typeof payload.smtpFrom !== "string") {
        return NextResponse.json({ error: "smtpFrom must be a string" }, { status: 400 });
      }
      await setSettingString(SETTING_SMTP_FROM, payload.smtpFrom);
    }

    const settings = await getAppSettings();
    const redactedForLog = {
      ...settings,
      smtp: {
        ...settings.smtp,
        smtpPass: "[REDACTED]",
      },
    };
    logger.info({ settings: redactedForLog, admin: session.user.email }, "App settings updated");

    recordAuditEvent("settings", "settings_updated", (session.user as any).id, {
      changedKeys: Object.keys(payload),
    });

    return NextResponse.json(settings);
  } catch (error) {
    logger.error({ error }, "Failed to update app settings");
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
