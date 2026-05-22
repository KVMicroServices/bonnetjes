import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// ─── Setting Keys ─────────────────────────────────────────────────────────────

export const SETTING_AUTO_VERIFY_ENABLED = "receipt_auto_verify_enabled";
export const SETTING_AUTO_DISABLE_ENABLED = "receipt_auto_disable_enabled";
export const SETTING_HIGH_CONFIDENCE_THRESHOLD = "high_confidence_threshold";
export const SETTING_AUTO_DISABLE_LOCATION_WHITELIST = "auto_disable_location_whitelist";
export const SETTING_SMTP_HOST = "smtp_host";
export const SETTING_SMTP_PORT = "smtp_port";
export const SETTING_SMTP_USER = "smtp_user";
export const SETTING_SMTP_PASS = "smtp_pass";
export const SETTING_SMTP_FROM = "smtp_from";
export const SETTING_OCR_PROMPT_CRITERIA = "ocr_prompt_criteria";
export const SETTING_SECONDARY_PROMPT_CRITERIA = "secondary_prompt_criteria";
export const SETTING_RECEIPT_MAX_AGE_MONTHS = "receipt_max_age_months";
export const SETTING_ENABLED_FAILURE_REASONS = "enabled_failure_reasons";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 70;
const DEFAULT_RECEIPT_MAX_AGE_MONTHS = 6;

// ─── Read (String) ────────────────────────────────────────────────────────────

export async function getSettingString(key: string, fallbackEnvVar: string): Promise<string | null> {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (setting && setting.value.length > 0) {
      return setting.value;
    }
  } catch (error) {
    logger.warn({ key, error }, "Failed to read app setting from database, falling back to env var");
  }

  const envValue = process.env[fallbackEnvVar];
  if (envValue && envValue.length > 0) {
    return envValue;
  }

  return null;
}

// ─── Read (Boolean) ───────────────────────────────────────────────────────────

export async function getSettingBoolean(key: string, fallbackEnvVar: string): Promise<boolean> {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (setting) {
      return setting.value === "true";
    }
  } catch (error) {
    logger.warn({ key, error }, "Failed to read app setting from database, falling back to env var");
  }

  return process.env[fallbackEnvVar] === "true";
}

// ─── Read (Integer) ───────────────────────────────────────────────────────────

export async function getSettingInteger(key: string, defaultValue: number): Promise<number> {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (setting) {
      const parsed = parseInt(setting.value, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    logger.warn({ key, error }, "Failed to read app setting from database, using default");
  }

  return defaultValue;
}

// ─── Convenience Readers ──────────────────────────────────────────────────────

export async function isAutoVerifyEnabled(): Promise<boolean> {
  return getSettingBoolean(SETTING_AUTO_VERIFY_ENABLED, "RECEIPT_AUTO_VERIFY_ENABLED");
}

export async function isAutoDisableEnabled(): Promise<boolean> {
  return getSettingBoolean(SETTING_AUTO_DISABLE_ENABLED, "RECEIPT_AUTO_DISABLE_ENABLED");
}

export async function getHighConfidenceThreshold(): Promise<number> {
  return getSettingInteger(SETTING_HIGH_CONFIDENCE_THRESHOLD, DEFAULT_HIGH_CONFIDENCE_THRESHOLD);
}

export async function getReceiptMaxAgeMonths(): Promise<number> {
  return getSettingInteger(SETTING_RECEIPT_MAX_AGE_MONTHS, DEFAULT_RECEIPT_MAX_AGE_MONTHS);
}

export async function getOcrPromptCriteria(): Promise<string | null> {
  return getSettingString(SETTING_OCR_PROMPT_CRITERIA, "");
}

export async function getSecondaryPromptCriteria(): Promise<string | null> {
  return getSettingString(SETTING_SECONDARY_PROMPT_CRITERIA, "");
}

export async function getEnabledFailureReasons(): Promise<readonly string[] | null> {
  const reasons = await getSettingStringArray(SETTING_ENABLED_FAILURE_REASONS);
  if (reasons.length === 0) {
    return null;
  }
  return reasons;
}

// ─── Read (String Array / JSON) ───────────────────────────────────────────────

export async function getSettingStringArray(key: string): Promise<readonly string[]> {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (setting) {
      const parsed = JSON.parse(setting.value);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    logger.warn({ key, error }, "Failed to read string array setting from database, returning empty");
  }

  return [];
}

// ─── Convenience Readers (String Array) ───────────────────────────────────────

export async function getAutoDisableLocationWhitelist(): Promise<readonly string[]> {
  return getSettingStringArray(SETTING_AUTO_DISABLE_LOCATION_WHITELIST);
}

/**
 * Checks whether auto-disable is allowed for a given locationId.
 * If the whitelist is empty, all locations are allowed.
 * If the whitelist has entries, only those locations are allowed.
 */
export async function isLocationAllowedForAutoDisable(locationId: string): Promise<boolean> {
  const whitelist = await getAutoDisableLocationWhitelist();
  if (whitelist.length === 0) {
    return true;
  }
  return whitelist.includes(locationId);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function setSettingString(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function setSettingBoolean(key: string, value: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

export async function setSettingInteger(key: string, value: number): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

export async function setSettingStringArray(key: string, value: readonly string[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
}

// ─── Bulk Read ────────────────────────────────────────────────────────────────

export interface SmtpSettings {
  smtpHost: string | null;
  smtpPort: string | null;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string | null;
}

export interface AppSettings {
  autoVerifyEnabled: boolean;
  autoDisableEnabled: boolean;
  autoDisableLocationWhitelist: readonly string[];
  highConfidenceThreshold: number;
  receiptMaxAgeMonths: number;
  ocrPromptCriteria: string | null;
  secondaryPromptCriteria: string | null;
  enabledFailureReasons: readonly string[] | null;
  smtp: SmtpSettings;
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  const smtpHost = await getSettingString(SETTING_SMTP_HOST, "SMTP_HOST");
  const smtpPort = await getSettingString(SETTING_SMTP_PORT, "SMTP_PORT");
  const smtpUser = await getSettingString(SETTING_SMTP_USER, "SMTP_USER");
  const smtpPass = await getSettingString(SETTING_SMTP_PASS, "SMTP_PASS");
  const smtpFrom = await getSettingString(SETTING_SMTP_FROM, "SMTP_FROM");

  return { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom };
}

export async function getAppSettings(): Promise<AppSettings> {
  const autoVerifyEnabled = await isAutoVerifyEnabled();
  const autoDisableEnabled = await isAutoDisableEnabled();
  const autoDisableLocationWhitelist = await getAutoDisableLocationWhitelist();
  const highConfidenceThreshold = await getHighConfidenceThreshold();
  const receiptMaxAgeMonths = await getReceiptMaxAgeMonths();
  const ocrPromptCriteria = await getOcrPromptCriteria();
  const secondaryPromptCriteria = await getSecondaryPromptCriteria();
  const enabledFailureReasons = await getEnabledFailureReasons();
  const smtp = await getSmtpSettings();

  return {
    autoVerifyEnabled,
    autoDisableEnabled,
    autoDisableLocationWhitelist,
    highConfidenceThreshold,
    receiptMaxAgeMonths,
    ocrPromptCriteria,
    secondaryPromptCriteria,
    enabledFailureReasons,
    smtp,
  };
}

// ─── Legacy alias ─────────────────────────────────────────────────────────────

export async function getFeatureToggles(): Promise<AppSettings> {
  return getAppSettings();
}
