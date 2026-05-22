export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { SUPPORTED_LOCALES } from "@/lib/i18n-config";
import {
  getOverridesForEmailType,
  getDefaultValues,
  upsertOverride,
  deleteOverride,
} from "@/lib/services/email-template-override-service";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  email: string;
  role: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_EMAIL_TYPES = ["disable", "verified", "disputeVerified", "finalRejection"] as const;
const MAXIMUM_VALUE_LENGTH = 2000;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const getQuerySchema = z.object({
  emailType: z.enum(VALID_EMAIL_TYPES),
  locale: z.enum(SUPPORTED_LOCALES),
});

const patchBodySchema = z.object({
  emailType: z.enum(VALID_EMAIL_TYPES),
  locale: z.enum(SUPPORTED_LOCALES),
  overrides: z.record(z.string(), z.string().max(MAXIMUM_VALUE_LENGTH)),
});

// ─── Auth Helper ─────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<{ authorized: true } | { authorized: false; response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { authorized: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const isAdmin = (session.user as SessionUser).role === "admin";
  if (!isAdmin) {
    return { authorized: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }

  return { authorized: true };
}

// ─── GET: Return overrides merged with defaults for a given emailType + locale ─

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.authorized) {
    return authResult.response;
  }

  const searchParams = request.nextUrl.searchParams;
  const rawEmailType = searchParams.get("emailType");
  const rawLocale = searchParams.get("locale");

  const parseResult = getQuerySchema.safeParse({
    emailType: rawEmailType,
    locale: rawLocale,
  });

  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid query parameters", details: parseResult.error.flatten() }, { status: 400 });
  }

  const { emailType, locale } = parseResult.data;

  try {
    const defaults = getDefaultValues(emailType);
    const overrides = await getOverridesForEmailType(emailType, locale);

    const merged: Record<string, string> = {};
    for (const key of Object.keys(defaults)) {
      if (overrides[key] !== undefined) {
        merged[key] = overrides[key];
      } else {
        merged[key] = defaults[key];
      }
    }

    return NextResponse.json({ emailType, locale, values: merged });
  } catch (error) {
    logger.error({ error, emailType, locale }, "Failed to fetch email template overrides");
    return NextResponse.json({ error: "Failed to fetch email template data" }, { status: 500 });
  }
}

// ─── PATCH: Upsert non-empty values, delete empty ones ───────────────────────

export async function PATCH(request: NextRequest) {
  const authResult = await requireAdmin();
  if (!authResult.authorized) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = patchBodySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid request body", details: parseResult.error.flatten() }, { status: 400 });
  }

  const { emailType, locale, overrides } = parseResult.data;

  try {
    const keys = Object.keys(overrides);
    for (const key of keys) {
      const value = overrides[key];
      if (value === "") {
        await deleteOverride(emailType, key, locale);
      } else {
        await upsertOverride(emailType, key, locale, value);
      }
    }

    logger.info({ emailType, locale, keyCount: keys.length }, "Email template overrides saved");
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ error, emailType, locale }, "Failed to save email template overrides");
    return NextResponse.json({ error: "Failed to save email template overrides" }, { status: 500 });
  }
}
