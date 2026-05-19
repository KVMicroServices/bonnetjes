import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// ─── Setting Keys ─────────────────────────────────────────────────────────────

export const SETTING_AUTO_VERIFY_ENABLED = "receipt_auto_verify_enabled";
export const SETTING_AUTO_DISABLE_ENABLED = "receipt_auto_disable_enabled";
export const SETTING_HIGH_CONFIDENCE_THRESHOLD = "high_confidence_threshold";
export const SETTING_LOW_CONFIDENCE_THRESHOLD = "low_confidence_threshold";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 70;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 30;

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

export async function getLowConfidenceThreshold(): Promise<number> {
  return getSettingInteger(SETTING_LOW_CONFIDENCE_THRESHOLD, DEFAULT_LOW_CONFIDENCE_THRESHOLD);
}

// ─── Write ────────────────────────────────────────────────────────────────────

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

// ─── Bulk Read ────────────────────────────────────────────────────────────────

export interface AppSettings {
  autoVerifyEnabled: boolean;
  autoDisableEnabled: boolean;
  highConfidenceThreshold: number;
  lowConfidenceThreshold: number;
}

export async function getAppSettings(): Promise<AppSettings> {
  const autoVerifyEnabled = await isAutoVerifyEnabled();
  const autoDisableEnabled = await isAutoDisableEnabled();
  const highConfidenceThreshold = await getHighConfidenceThreshold();
  const lowConfidenceThreshold = await getLowConfidenceThreshold();

  return { autoVerifyEnabled, autoDisableEnabled, highConfidenceThreshold, lowConfidenceThreshold };
}

// ─── Legacy alias ─────────────────────────────────────────────────────────────

export async function getFeatureToggles(): Promise<AppSettings> {
  return getAppSettings();
}
