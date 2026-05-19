import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupPrismaMock } from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockPrisma = setupPrismaMock();

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  getSettingBoolean,
  isAutoVerifyEnabled,
  isAutoDisableEnabled,
  setSettingBoolean,
  getFeatureToggles,
  SETTING_AUTO_VERIFY_ENABLED,
  SETTING_AUTO_DISABLE_ENABLED,
} from "@/lib/services/app-settings-service";

// ─── Tests: getSettingBoolean ──────────────────────────────────────────────────

describe("getSettingBoolean", () => {
  beforeEach(() => {
    delete process.env.TEST_SETTING;
  });

  it("returns true when DB setting value is 'true'", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: "test_key",
      value: "true",
      updatedAt: new Date(),
    });

    const result = await getSettingBoolean("test_key", "TEST_SETTING");

    expect(result).toBe(true);
  });

  it("returns false when DB setting value is 'false'", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: "test_key",
      value: "false",
      updatedAt: new Date(),
    });

    const result = await getSettingBoolean("test_key", "TEST_SETTING");

    expect(result).toBe(false);
  });

  it("falls back to env var when no DB row exists", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    process.env.TEST_SETTING = "true";

    const result = await getSettingBoolean("test_key", "TEST_SETTING");

    expect(result).toBe(true);
  });

  it("returns false when no DB row and env var is not set", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const result = await getSettingBoolean("test_key", "TEST_SETTING");

    expect(result).toBe(false);
  });

  it("returns false when no DB row and env var is 'false'", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    process.env.TEST_SETTING = "false";

    const result = await getSettingBoolean("test_key", "TEST_SETTING");

    expect(result).toBe(false);
  });

  it("falls back to env var when DB query throws", async () => {
    mockPrisma.appSetting.findUnique.mockRejectedValue(new Error("DB connection failed"));
    process.env.TEST_SETTING = "true";

    const result = await getSettingBoolean("test_key", "TEST_SETTING");

    expect(result).toBe(true);
  });

  it("returns false when DB throws and env var is not set", async () => {
    mockPrisma.appSetting.findUnique.mockRejectedValue(new Error("DB connection failed"));

    const result = await getSettingBoolean("test_key", "TEST_SETTING");

    expect(result).toBe(false);
  });
});

// ─── Tests: isAutoDisableEnabled ───────────────────────────────────────────────

describe("isAutoDisableEnabled", () => {
  beforeEach(() => {
    delete process.env.RECEIPT_AUTO_DISABLE_ENABLED;
  });

  it("returns false by default when no DB row and no env var", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const result = await isAutoDisableEnabled();

    expect(result).toBe(false);
    expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: SETTING_AUTO_DISABLE_ENABLED },
    });
  });

  it("returns true when DB setting is true", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: SETTING_AUTO_DISABLE_ENABLED,
      value: "true",
      updatedAt: new Date(),
    });

    const result = await isAutoDisableEnabled();

    expect(result).toBe(true);
  });

  it("returns false when DB setting is false even if env var is true", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: SETTING_AUTO_DISABLE_ENABLED,
      value: "false",
      updatedAt: new Date(),
    });
    process.env.RECEIPT_AUTO_DISABLE_ENABLED = "true";

    const result = await isAutoDisableEnabled();

    expect(result).toBe(false);
  });

  it("falls back to env var when no DB row exists", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    process.env.RECEIPT_AUTO_DISABLE_ENABLED = "true";

    const result = await isAutoDisableEnabled();

    expect(result).toBe(true);
  });
});

// ─── Tests: isAutoVerifyEnabled ────────────────────────────────────────────────

describe("isAutoVerifyEnabled", () => {
  beforeEach(() => {
    delete process.env.RECEIPT_AUTO_VERIFY_ENABLED;
  });

  it("returns false by default when no DB row and no env var", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const result = await isAutoVerifyEnabled();

    expect(result).toBe(false);
    expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: SETTING_AUTO_VERIFY_ENABLED },
    });
  });

  it("returns true when DB setting is true", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: SETTING_AUTO_VERIFY_ENABLED,
      value: "true",
      updatedAt: new Date(),
    });

    const result = await isAutoVerifyEnabled();

    expect(result).toBe(true);
  });

  it("DB value takes precedence over env var", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({
      key: SETTING_AUTO_VERIFY_ENABLED,
      value: "false",
      updatedAt: new Date(),
    });
    process.env.RECEIPT_AUTO_VERIFY_ENABLED = "true";

    const result = await isAutoVerifyEnabled();

    expect(result).toBe(false);
  });
});

// ─── Tests: setSettingBoolean ──────────────────────────────────────────────────

describe("setSettingBoolean", () => {
  it("upserts the setting with value 'true'", async () => {
    mockPrisma.appSetting.upsert.mockResolvedValue({
      key: "test_key",
      value: "true",
      updatedAt: new Date(),
    });

    await setSettingBoolean("test_key", true);

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "test_key" },
      update: { value: "true" },
      create: { key: "test_key", value: "true" },
    });
  });

  it("upserts the setting with value 'false'", async () => {
    mockPrisma.appSetting.upsert.mockResolvedValue({
      key: "test_key",
      value: "false",
      updatedAt: new Date(),
    });

    await setSettingBoolean("test_key", false);

    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "test_key" },
      update: { value: "false" },
      create: { key: "test_key", value: "false" },
    });
  });
});

// ─── Tests: getFeatureToggles ──────────────────────────────────────────────────

describe("getFeatureToggles", () => {
  beforeEach(() => {
    delete process.env.RECEIPT_AUTO_VERIFY_ENABLED;
    delete process.env.RECEIPT_AUTO_DISABLE_ENABLED;
  });

  it("returns both toggles as false when nothing is configured", async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const result = await getFeatureToggles();

    expect(result).toEqual({
      autoVerifyEnabled: false,
      autoDisableEnabled: false,
    });
  });

  it("returns correct values from DB settings", async () => {
    mockPrisma.appSetting.findUnique
      .mockResolvedValueOnce({
        key: SETTING_AUTO_VERIFY_ENABLED,
        value: "true",
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        key: SETTING_AUTO_DISABLE_ENABLED,
        value: "false",
        updatedAt: new Date(),
      });

    const result = await getFeatureToggles();

    expect(result).toEqual({
      autoVerifyEnabled: true,
      autoDisableEnabled: false,
    });
  });
});
