import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "@/lib/logger";
import { SUPPORTED_LOCALES } from "@/lib/i18n-config";
import type { SupportedLocale } from "@/lib/i18n-config";
import type { DisableEmailTranslations } from "@/lib/email/email-templates";

// ─── Constants ───────────────────────────────────────────────────────────────

const TRANSLATION_NAMESPACE = "ReviewDisableEmail";
const DEFAULT_LOCALE: SupportedLocale = "en";
const MESSAGES_DIRECTORY = join(process.cwd(), "messages");

const FAILURE_REASON_KEY_MAP: Readonly<Record<string, string>> = {
  NOT_A_RECEIPT: "failureNotAReceipt",
  IMAGE_UNCLEAR: "failureImageUnclear",
  INSUFFICIENT_INFO: "failureInsufficientInfo",
  DUPLICATE_RECEIPT: "failureDuplicateReceipt",
  RECEIPT_TOO_OLD: "failureReceiptTooOld",
  SUSPECTED_FRAUD: "failureSuspectedFraud",
  UNREADABLE_TEXT: "failureUnreadableText",
  MISSING_KEY_FIELDS: "failureMissingKeyFields",
  ADMIN_DISABLED: "failureAdminDisabled",
  VERIFICATION_FAILED: "failureVerificationFailed",
};

const TRANSLATION_KEYS: ReadonlyArray<keyof DisableEmailTranslations> = [
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
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

function loadMessagesForLocale(locale: string): Record<string, string> | null {
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
    logger.warn({ locale, error }, "Failed to load translation file for locale");
    return null;
  }
}

function getTranslationValue(
  messages: Record<string, string> | null,
  fallbackMessages: Record<string, string> | null,
  key: string
): string {
  if (messages && messages[key]) {
    return messages[key];
  }
  if (fallbackMessages && fallbackMessages[key]) {
    return fallbackMessages[key];
  }
  return key;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function loadDisableEmailTranslations(
  locale: string,
  failureReason: string
): DisableEmailTranslations {
  let resolvedLocale: SupportedLocale;
  if (isSupportedLocale(locale)) {
    resolvedLocale = locale;
  } else {
    resolvedLocale = DEFAULT_LOCALE;
  }

  const localeMessages = loadMessagesForLocale(resolvedLocale);
  let fallbackMessages: Record<string, string> | null = null;
  if (resolvedLocale !== DEFAULT_LOCALE) {
    fallbackMessages = loadMessagesForLocale(DEFAULT_LOCALE);
  }

  const failureReasonKey = FAILURE_REASON_KEY_MAP[failureReason];
  const resolvedFailureReasonKey = failureReasonKey
    ? failureReasonKey
    : "failureVerificationFailed";

  const result: Record<string, string> = {};
  for (const key of TRANSLATION_KEYS) {
    result[key] = getTranslationValue(localeMessages, fallbackMessages, key);
  }
  result.failureReasonText = getTranslationValue(
    localeMessages,
    fallbackMessages,
    resolvedFailureReasonKey
  );

  return result as unknown as DisableEmailTranslations;
}
