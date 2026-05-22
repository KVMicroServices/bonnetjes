import { readFileSync } from "fs";
import { join } from "path";
import { logger } from "@/lib/logger";
import { SUPPORTED_LOCALES } from "@/lib/i18n-config";
import { getFailureReasonTranslation } from "@/lib/services/failure-reason-service";
import type { SupportedLocale } from "@/lib/i18n-config";
import type { DisableEmailTranslations, VerifiedEmailTranslations, FinalRejectionEmailTranslations } from "@/lib/email/email-templates";

// ─── Constants ───────────────────────────────────────────────────────────────

const TRANSLATION_NAMESPACE = "ReviewDisableEmail";
const VERIFIED_NAMESPACE = "ReceiptVerifiedEmail";
const DISPUTE_VERIFIED_NAMESPACE = "DisputeVerifiedEmail";
const FINAL_REJECTION_NAMESPACE = "DisputeFinalRejectionEmail";
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

const VERIFIED_TRANSLATION_KEYS: ReadonlyArray<keyof VerifiedEmailTranslations> = [
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
];

const FINAL_REJECTION_TRANSLATION_KEYS: ReadonlyArray<keyof FinalRejectionEmailTranslations> = [
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
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

function loadMessagesForLocale(locale: string, namespaceName?: string): Record<string, string> | null {
  const filePath = join(MESSAGES_DIRECTORY, `${locale}.json`);
  let targetNamespace = TRANSLATION_NAMESPACE;
  if (namespaceName) {
    targetNamespace = namespaceName;
  }
  try {
    const fileContent = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(fileContent);
    const namespace = parsed[targetNamespace];
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

export async function loadDisableEmailTranslations(
  locale: string,
  failureReason: string
): Promise<DisableEmailTranslations> {
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

  const result: Record<string, string> = {};
  for (const key of TRANSLATION_KEYS) {
    result[key] = getTranslationValue(localeMessages, fallbackMessages, key);
  }

  // DB-first lookup for failure reason text
  let failureReasonText: string | null = null;
  try {
    failureReasonText = await getFailureReasonTranslation(failureReason, resolvedLocale);
  } catch (error) {
    logger.warn({ failureReason, locale: resolvedLocale, error }, "DB lookup for failure reason translation failed, falling back to message file");
  }

  if (!failureReasonText) {
    const failureReasonKey = FAILURE_REASON_KEY_MAP[failureReason];
    let resolvedFailureReasonKey: string;
    if (failureReasonKey) {
      resolvedFailureReasonKey = failureReasonKey;
    } else {
      resolvedFailureReasonKey = "failureVerificationFailed";
    }
    failureReasonText = getTranslationValue(localeMessages, fallbackMessages, resolvedFailureReasonKey);
  }

  result.failureReasonText = failureReasonText;

  return result as unknown as DisableEmailTranslations;
}

export function loadVerifiedEmailTranslations(
  locale: string,
  namespace: "receipt" | "dispute"
): VerifiedEmailTranslations {
  let resolvedLocale: SupportedLocale;
  if (isSupportedLocale(locale)) {
    resolvedLocale = locale;
  } else {
    resolvedLocale = DEFAULT_LOCALE;
  }

  let namespaceName: string;
  if (namespace === "receipt") {
    namespaceName = VERIFIED_NAMESPACE;
  } else {
    namespaceName = DISPUTE_VERIFIED_NAMESPACE;
  }

  const localeMessages = loadMessagesForLocale(resolvedLocale, namespaceName);
  let fallbackMessages: Record<string, string> | null = null;
  if (resolvedLocale !== DEFAULT_LOCALE) {
    fallbackMessages = loadMessagesForLocale(DEFAULT_LOCALE, namespaceName);
  }

  const result: Record<string, string> = {};
  for (const key of VERIFIED_TRANSLATION_KEYS) {
    result[key] = getTranslationValue(localeMessages, fallbackMessages, key);
  }

  return result as unknown as VerifiedEmailTranslations;
}

export async function loadFinalRejectionEmailTranslations(
  locale: string,
  failureReason: string
): Promise<FinalRejectionEmailTranslations & { readonly failureReasonText: string }> {
  let resolvedLocale: SupportedLocale;
  if (isSupportedLocale(locale)) {
    resolvedLocale = locale;
  } else {
    resolvedLocale = DEFAULT_LOCALE;
  }

  const localeMessages = loadMessagesForLocale(resolvedLocale, FINAL_REJECTION_NAMESPACE);
  let fallbackMessages: Record<string, string> | null = null;
  if (resolvedLocale !== DEFAULT_LOCALE) {
    fallbackMessages = loadMessagesForLocale(DEFAULT_LOCALE, FINAL_REJECTION_NAMESPACE);
  }

  const result: Record<string, string> = {};
  for (const key of FINAL_REJECTION_TRANSLATION_KEYS) {
    result[key] = getTranslationValue(localeMessages, fallbackMessages, key);
  }

  // DB-first lookup for failure reason text
  let failureReasonText: string | null = null;
  try {
    failureReasonText = await getFailureReasonTranslation(failureReason, resolvedLocale);
  } catch (error) {
    logger.warn({ failureReason, locale: resolvedLocale, error }, "DB lookup for failure reason translation failed, falling back to message file");
  }

  if (!failureReasonText) {
    const failureReasonKey = FAILURE_REASON_KEY_MAP[failureReason];
    let resolvedFailureReasonKey: string;
    if (failureReasonKey) {
      resolvedFailureReasonKey = failureReasonKey;
    } else {
      resolvedFailureReasonKey = "failureVerificationFailed";
    }

    // Load failure reason text from the disable email namespace (shared failure reason strings)
    const disableMessages = loadMessagesForLocale(resolvedLocale);
    let disableFallback: Record<string, string> | null = null;
    if (resolvedLocale !== DEFAULT_LOCALE) {
      disableFallback = loadMessagesForLocale(DEFAULT_LOCALE);
    }
    failureReasonText = getTranslationValue(disableMessages, disableFallback, resolvedFailureReasonKey);
  }

  result.failureReasonText = failureReasonText;

  return result as unknown as FinalRejectionEmailTranslations & { readonly failureReasonText: string };
}
