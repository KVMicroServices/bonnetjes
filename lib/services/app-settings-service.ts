import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// ─── Setting Keys ─────────────────────────────────────────────────────────────

export const SETTING_AUTO_VERIFY_ENABLED = "receipt_auto_verify_enabled";
export const SETTING_AUTO_DISABLE_ENABLED = "receipt_auto_disable_enabled";

// ─── Read ─────────────────────────────────────────────────────────────────────

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

export async function isAutoVerifyEnabled(): Promise<boolean> {
  return getSettingBoolean(SETTING_AUTO_VERIFY_ENABLED, "RECEIPT_AUTO_VERIFY_ENABLED");
}

export async function isAutoDisableEnabled(): Promise<boolean> {
  return getSettingBoolean(SETTING_AUTO_DISABLE_ENABLED, "RECEIPT_AUTO_DISABLE_ENABLED");
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function setSettingBoolean(key: string, value: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

// ─── Bulk Read ────────────────────────────────────────────────────────────────

interface FeatureToggles {
  autoVerifyEnabled: boolean;
  autoDisableEnabled: boolean;
}

export async function getFeatureToggles(): Promise<FeatureToggles> {
  const autoVerifyEnabled = await isAutoVerifyEnabled();
  const autoDisableEnabled = await isAutoDisableEnabled();

  return { autoVerifyEnabled, autoDisableEnabled };
}
