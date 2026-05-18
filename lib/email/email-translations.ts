import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "@/lib/logger";
import { SUPPORTED_LOCALES } from "@/lib/i18n-config";
import type { SupportedLocale } from "@/lib/i18n-config";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DisableEmailTranslations {
  readonly subject: string;
  readonly greeting: string;
  readonly body: string;
  readonly reasonLabel: string;
  readonly failureReasonText: string;
  readonly disputeButtonText: string;
  readonly footer: string;
}

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
  const resolvedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;

  const localeMessages = loadMessagesForLocale(resolvedLocale);
  const fallbackMessages =
    resolvedLocale === DEFAULT_LOCALE ? null : loadMessagesForLocale(DEFAULT_LOCALE);

  const effectiveMessages = localeMessages;
  const effectiveFallback = fallbackMessages;

  const failureReasonKey = FAILURE_REASON_KEY_MAP[failureReason];
  const resolvedFailureReasonKey = failureReasonKey
    ? failureReasonKey
    : "failureVerificationFailed";

  return {
    subject: getTranslationValue(effectiveMessages, effectiveFallback, "subject"),
    greeting: getTranslationValue(effectiveMessages, effectiveFallback, "greeting"),
    body: getTranslationValue(effectiveMessages, effectiveFallback, "body"),
    reasonLabel: getTranslationValue(effectiveMessages, effectiveFallback, "reasonLabel"),
    failureReasonText: getTranslationValue(
      effectiveMessages,
      effectiveFallback,
      resolvedFailureReasonKey
    ),
    disputeButtonText: getTranslationValue(
      effectiveMessages,
      effectiveFallback,
      "disputeButtonText"
    ),
    footer: getTranslationValue(effectiveMessages, effectiveFallback, "footer"),
  };
}
