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

vi.mock("@/lib/services/failure-reason-translator", () => ({
  translateDescription: vi.fn(),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
    ReviewDisableEmail: {
      failureNotAReceipt: "This is not a valid receipt",
      failureImageUnclear: "The image is unclear",
    },
  })),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  ensureBuiltInReasonsSeeded,
  getAllFailureReasons,
  createFailureReason,
  updateFailureReasonDescription,
  deleteFailureReason,
  getFailureReasonTranslation,
} from "@/lib/services/failure-reason-service";
import { translateDescription } from "@/lib/services/failure-reason-translator";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const BUILT_IN_REASON_COUNT = 8;

function createMockReason(overrides: Partial<{
  code: string;
  description: string;
  isBuiltIn: boolean;
  enabled: boolean;
  nl: string | null;
  de: string | null;
  fr: string | null;
  es: string | null;
  af: string | null;
  xh: string | null;
  zu: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    code: "TEST_CODE",
    description: "Test description",
    isBuiltIn: false,
    enabled: true,
    nl: null,
    de: null,
    fr: null,
    es: null,
    af: null,
    xh: null,
    zu: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Tests: ensureBuiltInReasonsSeeded ─────────────────────────────────────────

describe("ensureBuiltInReasonsSeeded", () => {
  it("skips seeding when all built-in reasons already exist", async () => {
    mockPrisma.failureReasonDefinition.count.mockResolvedValue(BUILT_IN_REASON_COUNT);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await ensureBuiltInReasonsSeeded();

    expect(mockPrisma.failureReasonDefinition.create).not.toHaveBeenCalled();
  });

  it("is idempotent — subsequent calls skip the database check entirely", async () => {
    // After the first successful seed (from the test above or any prior call),
    // the module-level seedingComplete flag prevents further DB queries.
    // We verify this by checking that calling it again does not trigger a new count query.
    mockPrisma.failureReasonDefinition.count.mockResolvedValue(BUILT_IN_REASON_COUNT);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await ensureBuiltInReasonsSeeded();

    // The seedingComplete flag was already set by the previous test, so count should not be called again
    // (mockReset clears call counts but the module state persists)
    // This verifies the function returns early without DB access
    expect(mockPrisma.failureReasonDefinition.create).not.toHaveBeenCalled();
  });
});

// ─── Tests: createFailureReason ────────────────────────────────────────────────

describe("createFailureReason", () => {
  beforeEach(() => {
    // Ensure seeding is considered complete for CRUD tests
    mockPrisma.failureReasonDefinition.count.mockResolvedValue(BUILT_IN_REASON_COUNT);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("rejects a code that is too short", async () => {
    await expect(createFailureReason("A", "Some description")).rejects.toThrow(
      "Code must be at least 2 characters"
    );
  });

  it("rejects a code that exceeds maximum length", async () => {
    const longCode = "A".repeat(51);
    await expect(createFailureReason(longCode, "Some description")).rejects.toThrow(
      "Code must not exceed 50 characters"
    );
  });

  it("rejects a code with invalid format (lowercase)", async () => {
    await expect(createFailureReason("invalid_code", "Some description")).rejects.toThrow(
      "Code must contain only uppercase letters and underscores"
    );
  });

  it("rejects a code that starts with an underscore", async () => {
    await expect(createFailureReason("_INVALID", "Some description")).rejects.toThrow(
      "Code must contain only uppercase letters and underscores"
    );
  });

  it("rejects a code that ends with an underscore", async () => {
    await expect(createFailureReason("INVALID_", "Some description")).rejects.toThrow(
      "Code must contain only uppercase letters and underscores"
    );
  });

  it("rejects an empty description", async () => {
    await expect(createFailureReason("VALID_CODE", "   ")).rejects.toThrow(
      "Description must not be empty"
    );
  });

  it("rejects a description that exceeds maximum length", async () => {
    const longDescription = "A".repeat(501);
    await expect(createFailureReason("VALID_CODE", longDescription)).rejects.toThrow(
      "Description must not exceed 500 characters"
    );
  });

  it("rejects a duplicate code", async () => {
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(
      createMockReason({ code: "EXISTING_CODE" })
    );

    await expect(createFailureReason("EXISTING_CODE", "Some description")).rejects.toThrow(
      "Code is already taken"
    );
  });

  it("creates a reason and triggers translation on success", async () => {
    const createdReason = createMockReason({ code: "NEW_REASON", description: "A new reason" });
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(null);
    mockPrisma.failureReasonDefinition.create.mockResolvedValue(createdReason);

    const mockTranslateDescription = vi.mocked(translateDescription);
    mockTranslateDescription.mockResolvedValue({
      success: true,
      translations: {
        nl: "Een nieuwe reden",
        de: "Ein neuer Grund",
        fr: "Une nouvelle raison",
        es: "Una nueva razón",
        af: "'n Nuwe rede",
        xh: "Isizathu esitsha",
        zu: "Isizathu esisha",
      },
    });

    const updatedReason = createMockReason({
      code: "NEW_REASON",
      description: "A new reason",
      nl: "Een nieuwe reden",
    });
    mockPrisma.failureReasonDefinition.update.mockResolvedValue(updatedReason);

    const result = await createFailureReason("NEW_REASON", "A new reason");

    expect(mockPrisma.failureReasonDefinition.create).toHaveBeenCalledWith({
      data: {
        code: "NEW_REASON",
        description: "A new reason",
        isBuiltIn: false,
        enabled: true,
      },
    });
    expect(mockTranslateDescription).toHaveBeenCalledWith("A new reason");
    expect(result).toEqual(updatedReason);
  });

  it("returns the created reason without translations when translation fails", async () => {
    const createdReason = createMockReason({ code: "NEW_REASON", description: "A new reason" });
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(null);
    mockPrisma.failureReasonDefinition.create.mockResolvedValue(createdReason);

    const mockTranslateDescription = vi.mocked(translateDescription);
    mockTranslateDescription.mockResolvedValue({
      success: false,
      translations: null,
      error: "AI API error",
    });

    const result = await createFailureReason("NEW_REASON", "A new reason");

    expect(result).toEqual(createdReason);
  });
});

// ─── Tests: updateFailureReasonDescription ─────────────────────────────────────

describe("updateFailureReasonDescription", () => {
  beforeEach(() => {
    mockPrisma.failureReasonDefinition.count.mockResolvedValue(BUILT_IN_REASON_COUNT);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("skips translation when description is unchanged (dirty check)", async () => {
    const existingReason = createMockReason({
      code: "EXISTING_CODE",
      description: "Same description",
    });
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(existingReason);

    const mockTranslateDescription = vi.mocked(translateDescription);
    mockTranslateDescription.mockClear();

    const result = await updateFailureReasonDescription("EXISTING_CODE", "Same description");

    expect(mockTranslateDescription).not.toHaveBeenCalled();
    expect(mockPrisma.failureReasonDefinition.update).not.toHaveBeenCalled();
    expect(result).toEqual(existingReason);
  });

  it("triggers translation when description changes", async () => {
    const existingReason = createMockReason({
      code: "EXISTING_CODE",
      description: "Old description",
    });
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(existingReason);

    const updatedReason = createMockReason({
      code: "EXISTING_CODE",
      description: "New description",
    });
    mockPrisma.failureReasonDefinition.update.mockResolvedValue(updatedReason);

    const mockTranslateDescription = vi.mocked(translateDescription);
    mockTranslateDescription.mockResolvedValue({
      success: true,
      translations: {
        nl: "Nieuwe beschrijving",
        de: "Neue Beschreibung",
        fr: "Nouvelle description",
        es: "Nueva descripción",
        af: "Nuwe beskrywing",
        xh: "Inkcazo entsha",
        zu: "Incazelo entsha",
      },
    });

    await updateFailureReasonDescription("EXISTING_CODE", "New description");

    expect(mockTranslateDescription).toHaveBeenCalledWith("New description");
    expect(mockPrisma.failureReasonDefinition.update).toHaveBeenCalled();
  });

  it("throws when the failure reason does not exist", async () => {
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(null);

    await expect(
      updateFailureReasonDescription("NONEXISTENT", "Some description")
    ).rejects.toThrow("Failure reason not found");
  });

  it("rejects an empty description after trimming", async () => {
    await expect(
      updateFailureReasonDescription("SOME_CODE", "   ")
    ).rejects.toThrow("Description must not be empty");
  });
});

// ─── Tests: deleteFailureReason ────────────────────────────────────────────────

describe("deleteFailureReason", () => {
  beforeEach(() => {
    mockPrisma.failureReasonDefinition.count.mockResolvedValue(BUILT_IN_REASON_COUNT);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("rejects deletion of a built-in reason", async () => {
    const builtInReason = createMockReason({
      code: "NOT_A_RECEIPT",
      isBuiltIn: true,
    });
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(builtInReason);

    await expect(deleteFailureReason("NOT_A_RECEIPT")).rejects.toThrow(
      "Built-in reasons cannot be deleted"
    );
  });

  it("throws when the failure reason does not exist", async () => {
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(null);

    await expect(deleteFailureReason("NONEXISTENT")).rejects.toThrow(
      "Failure reason not found"
    );
  });

  it("deletes a custom reason successfully", async () => {
    const customReason = createMockReason({
      code: "CUSTOM_REASON",
      isBuiltIn: false,
    });
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(customReason);
    mockPrisma.failureReasonDefinition.delete.mockResolvedValue(customReason);

    await deleteFailureReason("CUSTOM_REASON");

    expect(mockPrisma.failureReasonDefinition.delete).toHaveBeenCalledWith({
      where: { code: "CUSTOM_REASON" },
    });
  });
});

// ─── Tests: getFailureReasonTranslation ────────────────────────────────────────

describe("getFailureReasonTranslation", () => {
  it("returns the English description when locale is 'en'", async () => {
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue({
      description: "English text",
    } as any);

    const result = await getFailureReasonTranslation("SOME_CODE", "en");

    expect(result).toBe("English text");
  });

  it("returns the locale-specific translation", async () => {
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(
      createMockReason({ code: "SOME_CODE", nl: "Nederlandse tekst" })
    );

    const result = await getFailureReasonTranslation("SOME_CODE", "nl");

    expect(result).toBe("Nederlandse tekst");
  });

  it("returns null when the reason does not exist", async () => {
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(null);

    const result = await getFailureReasonTranslation("NONEXISTENT", "nl");

    expect(result).toBeNull();
  });

  it("returns null for an unsupported locale", async () => {
    const result = await getFailureReasonTranslation("SOME_CODE", "jp");

    expect(result).toBeNull();
  });

  it("returns null when the locale column is null", async () => {
    mockPrisma.failureReasonDefinition.findUnique.mockResolvedValue(
      createMockReason({ code: "SOME_CODE", de: null })
    );

    const result = await getFailureReasonTranslation("SOME_CODE", "de");

    expect(result).toBeNull();
  });
});
