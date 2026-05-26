export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { SUPPORTED_LOCALES } from "@/lib/i18n-config";
import type { SupportedLocale } from "@/lib/i18n-config";
import { bulkUpsertOverrides } from "@/lib/services/email-template-override-service";
import { translateEmailTemplateEntry } from "@/lib/services/email-template-translator";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  email: string;
  role: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_EMAIL_TYPES = ["disable", "verified", "disputeVerified", "finalRejection"] as const;
const MAXIMUM_VALUE_LENGTH = 2000;
const MAXIMUM_ENTRIES = 50;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const translateBodySchema = z.object({
  emailType: z.enum(VALID_EMAIL_TYPES),
  sourceLocale: z.enum(SUPPORTED_LOCALES),
  entries: z.array(
    z.object({
      key: z.string().min(1),
      value: z.string().min(1).max(MAXIMUM_VALUE_LENGTH),
    })
  ).min(1).max(MAXIMUM_ENTRIES),
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

// ─── POST: Translate dirty entries to all other locales ──────────────────────

export async function POST(request: NextRequest) {
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

  const parseResult = translateBodySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid request body", details: parseResult.error.flatten() }, { status: 400 });
  }

  const { emailType, sourceLocale, entries } = parseResult.data;

  const targetLocales: ReadonlyArray<SupportedLocale> = SUPPORTED_LOCALES.filter(
    (locale) => locale !== sourceLocale
  );

  let translatedCount = 0;
  const failedKeys: string[] = [];

  for (const entry of entries) {
    try {
      const translationResult = await translateEmailTemplateEntry(entry.value, sourceLocale, targetLocales);

      if (!translationResult.success) {
        failedKeys.push(entry.key);
        logger.warn({ key: entry.key, emailType, error: translationResult.error }, "Translation failed for entry");
        continue;
      }

      for (const targetLocale of targetLocales) {
        const translatedValue = translationResult.translations[targetLocale];
        if (translatedValue) {
          await bulkUpsertOverrides(emailType, targetLocale, [{ key: entry.key, value: translatedValue }]);
        }
      }

      translatedCount = translatedCount + 1;
    } catch (error) {
      failedKeys.push(entry.key);
      logger.error({ error, key: entry.key, emailType }, "Unexpected error translating entry");
    }
  }

  logger.info({ emailType, sourceLocale, translatedCount, failedCount: failedKeys.length }, "Email template translation completed");

  return NextResponse.json({ translated: translatedCount, failed: failedKeys });
}
