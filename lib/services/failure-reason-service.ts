import { readFileSync } from "fs";
import { join } from "path";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { FAILURE_REASONS } from "@/lib/services/ocr-constants";
import { translateDescription } from "@/lib/services/failure-reason-translator";
import { SETTING_ENABLED_FAILURE_REASONS } from "@/lib/services/app-settings-service";

// ─── Constants ───────────────────────────────────────────────────────────────

const CODE_PATTERN = /^[A-Z][A-Z_]*[A-Z]$/;
const MINIMUM_CODE_LENGTH = 2;
const MAXIMUM_CODE_LENGTH = 50;
const MAXIMUM_DESCRIPTION_LENGTH = 500;

const MESSAGES_DIRECTORY = join(process.cwd(), "messages");
const TRANSLATION_NAMESPACE = "ReviewDisableEmail";

const TRANSLATION_LOCALES = ["nl", "de", "fr", "es", "af", "xh", "zu"] as const;

const FAILURE_REASON_KEY_MAP: Readonly<Record<string, string>> = {
  NOT_A_RECEIPT: "failureNotAReceipt",
  IMAGE_UNCLEAR: "failureImageUnclear",
  INSUFFICIENT_INFO: "failureInsufficientInfo",
  DUPLICATE_RECEIPT: "failureDuplicateReceipt",
  RECEIPT_TOO_OLD: "failureReceiptTooOld",
  SUSPECTED_FRAUD: "failureSuspectedFraud",
  UNREADABLE_TEXT: "failureUnreadableText",
  MISSING_KEY_FIELDS: "failureMissingKeyFields",
};

// ─── Seeding State ───────────────────────────────────────────────────────────

let seedingPromise: Promise<void> | null = null;

// ─── Message File Helpers ────────────────────────────────────────────────────

function loadMessageNamespace(locale: string): Record<string, string> | null {
  const filePath = join(MESSAGES_DIRECTORY, `${locale}.json`);
  try {
    const fileContent = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(fileContent);
    const namespace = parsed[TRANSLATION_NAMESPACE];
    if (!namespace) {
      return null;
    }
    return namespace as Record<string, string>;
  } catch (error) {
    logger.warn({ locale, error }, "Failed to load message file for seeding");
    return null;
  }
}

function getDescriptionFromMessages(code: string, locale: string): string | null {
  const messages = loadMessageNamespace(locale);
  if (!messages) {
    return null;
  }
  const key = FAILURE_REASON_KEY_MAP[code];
  if (!key) {
    return null;
  }
  const value = messages[key];
  if (!value) {
    return null;
  }
  return value;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateCode(code: string): string | null {
  if (!code || code.length < MINIMUM_CODE_LENGTH) {
    return `Code must be at least ${MINIMUM_CODE_LENGTH} characters`;
  }
  if (code.length > MAXIMUM_CODE_LENGTH) {
    return `Code must not exceed ${MAXIMUM_CODE_LENGTH} characters`;
  }
  if (!CODE_PATTERN.test(code)) {
    return "Code must contain only uppercase letters and underscores, and must not start or end with an underscore";
  }
  return null;
}

function validateDescription(description: string): string | null {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return "Description must not be empty";
  }
  if (trimmed.length > MAXIMUM_DESCRIPTION_LENGTH) {
    return `Description must not exceed ${MAXIMUM_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/** Lazily seeds built-in failure reasons from FAILURE_REASONS codes and message file translations. */
export async function ensureBuiltInReasonsSeeded(): Promise<void> {
  if (seedingPromise) {
    return seedingPromise;
  }
  seedingPromise = performSeeding().catch((error) => {
    seedingPromise = null;
    throw error;
  });
  return seedingPromise;
}

async function performSeeding(): Promise<void> {
  const existingCount = await prisma.failureReasonDefinition.count({
    where: {
      code: { in: [...FAILURE_REASONS] },
    },
  });

  if (existingCount === FAILURE_REASONS.length) {
    await migrateEnabledFailureReasonsSetting();
    return;
  }

  for (const code of FAILURE_REASONS) {
    const existing = await prisma.failureReasonDefinition.findUnique({
      where: { code },
    });

    if (existing) {
      continue;
    }

    const englishDescription = getDescriptionFromMessages(code, "en");
    let description: string;
    if (englishDescription) {
      description = englishDescription;
    } else {
      description = code;
    }

    const localeData: Record<string, string | null> = {};
    for (const locale of TRANSLATION_LOCALES) {
      localeData[locale] = getDescriptionFromMessages(code, locale);
    }

    await prisma.failureReasonDefinition.create({
      data: {
        code,
        description,
        isBuiltIn: true,
        enabled: true,
        nl: localeData.nl,
        de: localeData.de,
        fr: localeData.fr,
        es: localeData.es,
        af: localeData.af,
        xh: localeData.xh,
        zu: localeData.zu,
      },
    });

    logger.info({ code }, "Seeded built-in failure reason");
  }

  await migrateEnabledFailureReasonsSetting();
}

/** Migrates the legacy SETTING_ENABLED_FAILURE_REASONS AppSetting to per-reason enabled flags. */
async function migrateEnabledFailureReasonsSetting(): Promise<void> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: SETTING_ENABLED_FAILURE_REASONS },
    });

    if (!setting) {
      return;
    }

    let enabledCodes: string[];
    try {
      const parsed = JSON.parse(setting.value);
      if (!Array.isArray(parsed)) {
        return;
      }
      enabledCodes = parsed.filter((item: unknown) => typeof item === "string");
    } catch {
      logger.warn("Failed to parse legacy enabledFailureReasons setting, skipping migration");
      return;
    }

    // Disable any built-in reason NOT in the enabled list
    for (const code of FAILURE_REASONS) {
      const isEnabled = enabledCodes.includes(code);
      if (!isEnabled) {
        await prisma.failureReasonDefinition.updateMany({
          where: { code },
          data: { enabled: false },
        });
      }
    }

    // Delete the legacy AppSetting key
    await prisma.appSetting.delete({
      where: { key: SETTING_ENABLED_FAILURE_REASONS },
    });

    logger.info({ enabledCodes }, "Migrated legacy enabledFailureReasons setting to per-reason enabled flags");
  } catch (error) {
    logger.error({ error }, "Failed to migrate legacy enabledFailureReasons setting");
  }
}

// ─── CRUD Operations ─────────────────────────────────────────────────────────

/** Toggles the enabled status of a failure reason. */
export async function toggleFailureReasonEnabled(code: string, enabled: boolean) {
  await ensureBuiltInReasonsSeeded();
  return prisma.failureReasonDefinition.update({
    where: { code },
    data: { enabled },
  });
}

/** Returns all failure reason definitions. */
export async function getAllFailureReasons() {
  await ensureBuiltInReasonsSeeded();
  return prisma.failureReasonDefinition.findMany({
    orderBy: { createdAt: "asc" },
  });
}

/** Creates a new custom failure reason and triggers translation. */
export async function createFailureReason(code: string, description: string) {
  await ensureBuiltInReasonsSeeded();

  const codeError = validateCode(code);
  if (codeError) {
    throw new Error(codeError);
  }

  const trimmedDescription = description.trim();
  const descriptionError = validateDescription(trimmedDescription);
  if (descriptionError) {
    throw new Error(descriptionError);
  }

  const existing = await prisma.failureReasonDefinition.findUnique({
    where: { code },
  });
  if (existing) {
    throw new Error("Code is already taken");
  }

  const created = await prisma.failureReasonDefinition.create({
    data: {
      code,
      description: trimmedDescription,
      isBuiltIn: false,
      enabled: true,
    },
  });

  logger.info({ code }, "Created custom failure reason");

  // Trigger translation asynchronously — non-blocking on failure
  try {
    const translationResult = await translateDescription(trimmedDescription);
    if (translationResult.success && translationResult.translations) {
      const updated = await prisma.failureReasonDefinition.update({
        where: { code },
        data: {
          nl: translationResult.translations.nl,
          de: translationResult.translations.de,
          fr: translationResult.translations.fr,
          es: translationResult.translations.es,
          af: translationResult.translations.af,
          xh: translationResult.translations.xh,
          zu: translationResult.translations.zu,
        },
      });
      return updated;
    }
    logger.warn({ code }, "Translation failed for new failure reason, saved without translations");
  } catch (error) {
    logger.error({ code, error }, "Translation error for new failure reason");
  }

  return created;
}

/** Updates the English description of an existing failure reason. Triggers translation only if description changed. */
export async function updateFailureReasonDescription(code: string, description: string) {
  await ensureBuiltInReasonsSeeded();

  const trimmedDescription = description.trim();
  const descriptionError = validateDescription(trimmedDescription);
  if (descriptionError) {
    throw new Error(descriptionError);
  }

  const existing = await prisma.failureReasonDefinition.findUnique({
    where: { code },
  });
  if (!existing) {
    throw new Error("Failure reason not found");
  }

  // Dirty check: skip if description unchanged
  if (existing.description === trimmedDescription) {
    return existing;
  }

  let updated = await prisma.failureReasonDefinition.update({
    where: { code },
    data: { description: trimmedDescription },
  });

  logger.info({ code }, "Updated failure reason description");

  // Trigger translation since description changed
  try {
    const translationResult = await translateDescription(trimmedDescription);
    if (translationResult.success && translationResult.translations) {
      updated = await prisma.failureReasonDefinition.update({
        where: { code },
        data: {
          nl: translationResult.translations.nl,
          de: translationResult.translations.de,
          fr: translationResult.translations.fr,
          es: translationResult.translations.es,
          af: translationResult.translations.af,
          xh: translationResult.translations.xh,
          zu: translationResult.translations.zu,
        },
      });
    } else {
      logger.warn({ code }, "Translation failed on description update, retaining previous translations");
    }
  } catch (error) {
    logger.error({ code, error }, "Translation error on description update");
  }

  return updated;
}

/** Deletes a custom failure reason. Built-in reasons cannot be deleted. */
export async function deleteFailureReason(code: string): Promise<void> {
  await ensureBuiltInReasonsSeeded();

  const existing = await prisma.failureReasonDefinition.findUnique({
    where: { code },
  });
  if (!existing) {
    throw new Error("Failure reason not found");
  }
  if (existing.isBuiltIn) {
    throw new Error("Built-in reasons cannot be deleted");
  }

  await prisma.failureReasonDefinition.delete({
    where: { code },
  });

  logger.info({ code }, "Deleted custom failure reason");
}

// ─── Query Helpers ───────────────────────────────────────────────────────────

/** Returns the locale translation for a given failure reason code, or null if not found. */
export async function getFailureReasonTranslation(code: string, locale: string): Promise<string | null> {
  if (locale === "en") {
    const reason = await prisma.failureReasonDefinition.findUnique({
      where: { code },
      select: { description: true },
    });
    if (!reason) {
      return null;
    }
    return reason.description;
  }

  const validLocales = ["nl", "de", "fr", "es", "af", "xh", "zu"];
  if (!validLocales.includes(locale)) {
    return null;
  }

  const reason = await prisma.failureReasonDefinition.findUnique({
    where: { code },
  });
  if (!reason) {
    return null;
  }

  const localeValue = reason[locale as keyof typeof reason];
  if (typeof localeValue === "string") {
    return localeValue;
  }
  return null;
}

/** Returns all enabled failure reasons with their code and English description. */
export async function getEnabledFailureReasonsWithDescriptions(): Promise<ReadonlyArray<{ code: string; description: string }>> {
  await ensureBuiltInReasonsSeeded();

  const reasons = await prisma.failureReasonDefinition.findMany({
    where: { enabled: true },
    select: { code: true, description: true },
    orderBy: { createdAt: "asc" },
  });

  return reasons;
}
