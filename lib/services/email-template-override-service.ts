import { readFileSync } from "fs";
import { join } from "path";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

const MESSAGES_DIRECTORY = join(process.cwd(), "messages");
const DEFAULT_LOCALE = "en";

type EmailType = "disable" | "verified" | "disputeVerified" | "finalRejection";

const EMAIL_TYPE_NAMESPACE_MAP: Readonly<Record<EmailType, string>> = {
  disable: "ReviewDisableEmail",
  verified: "ReceiptVerifiedEmail",
  disputeVerified: "DisputeVerifiedEmail",
  finalRejection: "DisputeFinalRejectionEmail",
};

const EMAIL_TYPE_KEYS: Readonly<Record<EmailType, readonly string[]>> = {
  disable: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "intro",
    "guidelinesLinkText",
    "requirementsIntro",
    "requirementCompanyName",
    "requirementDate",
    "requirementOrderNumber",
    "requirementCustomerName",
    "disputePrompt",
    "disputeButtonText",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
    "reasonLabel",
  ],
  verified: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "body",
    "thankYou",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
    "shopLabel",
    "dateLabel",
    "amountLabel",
  ],
  disputeVerified: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "body",
    "thankYou",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
    "shopLabel",
    "dateLabel",
    "amountLabel",
  ],
  finalRejection: [
    "subject",
    "headerTagline",
    "headerTitle",
    "greeting",
    "body",
    "reasonLabel",
    "supportPrompt",
    "signOff",
    "teamName",
    "termsButtonText",
    "privacyButtonText",
    "questionsLabel",
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidEmailType(emailType: string): emailType is EmailType {
  return emailType in EMAIL_TYPE_NAMESPACE_MAP;
}

function loadNamespaceFromMessageFile(namespace: string, locale: string): Record<string, string> | null {
  const filePath = join(MESSAGES_DIRECTORY, `${locale}.json`);
  try {
    const fileContent = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(fileContent);
    const namespaceData = parsed[namespace];
    if (!namespaceData) {
      return null;
    }
    return namespaceData as Record<string, string>;
  } catch (error) {
    logger.warn({ locale, namespace, error }, "Failed to load message file namespace");
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns all overrides for a given email type and locale as a key→value map. */
export async function getOverridesForEmailType(
  emailType: string,
  locale: string
): Promise<Record<string, string>> {
  try {
    const records = await prisma.emailTemplateOverride.findMany({
      where: { emailType, locale },
    });

    const overrideMap: Record<string, string> = {};
    for (const record of records) {
      overrideMap[record.key] = record.value;
    }
    return overrideMap;
  } catch (error) {
    logger.error({ emailType, locale, error }, "Failed to fetch email template overrides");
    return {};
  }
}

/** Creates or updates an override for a specific (emailType, key, locale) combination. */
export async function upsertOverride(
  emailType: string,
  key: string,
  locale: string,
  value: string
): Promise<void> {
  try {
    await prisma.emailTemplateOverride.upsert({
      where: {
        emailType_key_locale: { emailType, key, locale },
      },
      update: { value },
      create: { emailType, key, locale, value },
    });
  } catch (error) {
    logger.error({ emailType, key, locale, error }, "Failed to upsert email template override");
    throw error;
  }
}

/** Deletes an override, reverting to the default message file value. */
export async function deleteOverride(
  emailType: string,
  key: string,
  locale: string
): Promise<void> {
  try {
    await prisma.emailTemplateOverride.delete({
      where: {
        emailType_key_locale: { emailType, key, locale },
      },
    });
  } catch (error) {
    logger.error({ emailType, key, locale, error }, "Failed to delete email template override");
    throw error;
  }
}

/** Batch upserts multiple overrides for a given email type and locale. */
export async function bulkUpsertOverrides(
  emailType: string,
  locale: string,
  entries: ReadonlyArray<{ key: string; value: string }>
): Promise<void> {
  try {
    const operations = entries.map((entry) =>
      prisma.emailTemplateOverride.upsert({
        where: {
          emailType_key_locale: { emailType, key: entry.key, locale },
        },
        update: { value: entry.value },
        create: { emailType, key: entry.key, locale, value: entry.value },
      })
    );
    await prisma.$transaction(operations);
  } catch (error) {
    logger.error({ emailType, locale, entryCount: entries.length, error }, "Failed to bulk upsert email template overrides");
    throw error;
  }
}

/** Reads the default English values from messages/en.json for a given email type. */
export function getDefaultValues(emailType: string): Record<string, string> {
  if (!isValidEmailType(emailType)) {
    logger.warn({ emailType }, "Unknown email type requested for defaults");
    return {};
  }

  const namespace = EMAIL_TYPE_NAMESPACE_MAP[emailType];
  const validKeys = EMAIL_TYPE_KEYS[emailType];
  const allMessages = loadNamespaceFromMessageFile(namespace, DEFAULT_LOCALE);

  if (!allMessages) {
    return {};
  }

  const defaults: Record<string, string> = {};
  for (const key of validKeys) {
    const value = allMessages[key];
    if (value) {
      defaults[key] = value;
    }
  }
  return defaults;
}

// ─── Exported Constants ──────────────────────────────────────────────────────

export { EMAIL_TYPE_NAMESPACE_MAP, EMAIL_TYPE_KEYS };
export type { EmailType };
