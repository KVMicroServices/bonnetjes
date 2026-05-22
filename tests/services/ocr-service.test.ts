import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockDeep, DeepMockProxy } from "vitest-mock-extended";
import { PrismaClient } from "@prisma/client";
import {
  buildOcrMessages,
  parseOcrResult,
  determineVerificationStatus,
  callOcrApi,
  processReceiptOcr,
  createOcrApiConfig,
} from "@/lib/services/ocr-service";
import type {
  OcrServiceDependencies,
  StorageClient,
  FraudDetectionClient,
  OcrApiConfig,
  ParsedOcrResult,
} from "@/lib/services/ocr-service";

vi.mock("@/lib/services/app-settings-service", () => ({
  getHighConfidenceThreshold: vi.fn().mockResolvedValue(70),
  getOcrPromptCriteria: vi.fn().mockResolvedValue(null),
  getSecondaryPromptCriteria: vi.fn().mockResolvedValue(null),
  getReceiptMaxAgeMonths: vi.fn().mockResolvedValue(6),
}));

vi.mock("@/lib/services/failure-reason-service", () => ({
  getEnabledFailureReasonsWithDescriptions: vi.fn().mockResolvedValue([
    { code: "NOT_A_RECEIPT", description: "The image is not a purchase receipt" },
    { code: "IMAGE_UNCLEAR", description: "The image is too blurry, dark, or damaged to read" },
    { code: "INSUFFICIENT_INFO", description: "The receipt lacks key information" },
    { code: "DUPLICATE_RECEIPT", description: "This receipt has already been submitted" },
    { code: "RECEIPT_TOO_OLD", description: "The receipt is too old" },
    { code: "SUSPECTED_FRAUD", description: "The receipt appears to be fraudulent" },
    { code: "UNREADABLE_TEXT", description: "Text is present but cannot be reliably extracted" },
    { code: "MISSING_KEY_FIELDS", description: "Some required fields are completely absent" },
  ]),
}));

vi.mock("@/lib/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn(),
}));

// ─── Mock Factories ────────────────────────────────────────────────────────────

function createMockDependencies(): {
  database: DeepMockProxy<PrismaClient>;
  storage: StorageClient;
  fraudDetection: FraudDetectionClient;
} {
  return {
    database: mockDeep<PrismaClient>(),
    storage: {
      getFileAsBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-image-content")),
    },
    fraudDetection: {
      detectSuspiciousPatterns: vi.fn().mockResolvedValue({ patterns: [], riskScore: 0 }),
      calculateFraudRiskScore: vi.fn().mockReturnValue(10),
    },
  };
}

function createMockOcrApiConfig(overrides?: Partial<OcrApiConfig>): OcrApiConfig {
  return {
    baseUrl: "https://api.test.com/v1",
    apiKey: "test-api-key",
    model: "gpt-5.4-nano",
    streaming: false,
    ...overrides,
  };
}

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const USER_ID = "user-123";
const RECEIPT_ID = "receipt-001";

const SAMPLE_RECEIPT = {
  id: RECEIPT_ID,
  userId: USER_ID,
  cloudStoragePath: "uploads/receipt.jpg",
  isPublic: false,
  originalFilename: "receipt.jpg",
  fileType: "image",
  fileSize: 150000,
  verificationStatus: "pending",
  imageHash: "abc123hash",
  isDuplicate: false,
  duplicateOfId: null,
  manipulationScore: 0,
  manipulationFlags: "[]",
  suspiciousPatterns: "[]",
  fraudRiskScore: 5,
  extractedShopName: null,
  extractedDate: null,
  extractedAmount: null,
  ocrConfidence: null,
  ocrReasoning: null,
  receiptReadable: null,
  failureReason: null,
  secondaryAnalysis: null,
  isArchived: false,
  archivedAt: null,
  createdAt: new Date("2024-01-15T10:00:00Z"),
  updatedAt: new Date("2024-01-15T10:00:00Z"),
  queuedAt: null,
  processedAt: null,
};

const VALID_OCR_JSON = JSON.stringify({
  extractedShopName: "Albert Heijn",
  extractedDate: "2024-06-15",
  extractedAmount: 42.5,
  receiptReadable: true,
  confidence: 85,
  reasoning: "Clear receipt with visible shop name and date",
  failureReason: null,
});

// ─── Tests: buildOcrMessages ───────────────────────────────────────────────────

const TEST_OCR_PROMPT = "Test OCR prompt for verification";

describe("buildOcrMessages", () => {
  it("produces image_url content for image files", () => {
    const buffer = Buffer.from("fake-image-data");
    const messages = buildOcrMessages(buffer, TEST_OCR_PROMPT);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toHaveLength(2);

    const textContent = messages[0].content[0];
    expect(textContent.type).toBe("text");

    const imageContent = messages[0].content[1];
    expect(imageContent.type).toBe("image_url");
    if (imageContent.type === "image_url") {
      expect(imageContent.image_url.url).toContain("data:image/jpeg;base64,");
    }
  });

  it("treats PDF input as image data (PDF conversion happens at higher level)", () => {
    const buffer = Buffer.from("fake-pdf-data");
    const messages = buildOcrMessages(buffer, TEST_OCR_PROMPT);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toHaveLength(2);

    const textContent = messages[0].content[0];
    expect(textContent.type).toBe("text");

    const imageContent = messages[0].content[1];
    expect(imageContent.type).toBe("image_url");
    if (imageContent.type === "image_url") {
      expect(imageContent.image_url.url).toContain("data:image/jpeg;base64,");
    }
  });

  it("does not have PDF-specific handling (conversion is done before calling buildOcrMessages)", () => {
    const buffer = Buffer.from("fake-pdf-data");
    const messages = buildOcrMessages(buffer, TEST_OCR_PROMPT);

    const textContent = messages[0].content[0];
    if (textContent.type === "text") {
      expect(textContent.text).not.toContain("PDF document");
    }
  });

  it("uses the provided prompt text in the message content", () => {
    const buffer = Buffer.from("fake-image-data");
    const customPrompt = "Custom verification instructions here";
    const messages = buildOcrMessages(buffer, customPrompt);

    const textContent = messages[0].content[0];
    if (textContent.type === "text") {
      expect(textContent.text).toBe(customPrompt);
    }
  });
});

// ─── Tests: parseOcrResult ─────────────────────────────────────────────────────

describe("parseOcrResult", () => {
  it("parses valid JSON correctly", () => {
    const result = parseOcrResult(VALID_OCR_JSON);

    expect(result.extractedShopName).toBe("Albert Heijn");
    expect(result.extractedAmount).toBe(42.5);
    expect(result.receiptReadable).toBe(true);
    expect(result.confidence).toBe(85);
    expect(result.reasoning).toBe("Clear receipt with visible shop name and date");
    expect(result.failureReason).toBeNull();
  });

  it("coerces date string to Date object", () => {
    const result = parseOcrResult(VALID_OCR_JSON);

    expect(result.extractedDate).toBeInstanceOf(Date);
    expect(result.extractedDate!.toISOString()).toContain("2024-06-15");
  });

  it("handles null date gracefully", () => {
    const json = JSON.stringify({
      extractedShopName: "Shop",
      extractedDate: null,
      extractedAmount: 10,
      receiptReadable: true,
      confidence: 50,
      reasoning: "No date found",
    });

    const result = parseOcrResult(json);
    expect(result.extractedDate).toBeNull();
  });

  it("coerces string amount to number", () => {
    const json = JSON.stringify({
      extractedShopName: "Shop",
      extractedDate: "2024-01-01",
      extractedAmount: "25.99",
      receiptReadable: true,
      confidence: 70,
      reasoning: "Amount was string",
    });

    const result = parseOcrResult(json);
    expect(result.extractedAmount).toBe(25.99);
  });

  it("handles null amount", () => {
    const json = JSON.stringify({
      extractedShopName: "Shop",
      extractedDate: "2024-01-01",
      extractedAmount: null,
      receiptReadable: true,
      confidence: 60,
      reasoning: "No amount found",
    });

    const result = parseOcrResult(json);
    expect(result.extractedAmount).toBeNull();
  });
});

// ─── Tests: determineVerificationStatus ────────────────────────────────────────

describe("determineVerificationStatus", () => {
  const recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - 7);

  const highConfidenceReadableResult: ParsedOcrResult = {
    extractedShopName: "Albert Heijn",
    extractedDate: recentDate,
    extractedAmount: 42.5,
    receiptReadable: true,
    confidence: 85,
    reasoning: "Clear receipt",
    failureReason: null,
  };

  it("returns verified for high confidence, readable, no failure, with shop and date", () => {
    const decision = determineVerificationStatus(
      highConfidenceReadableResult,
      false,
      recentDate
    );

    expect(decision.status).toBe("verified");
    expect(decision.failureReason).toBeNull();
    expect(decision.isDateTooOld).toBe(false);
  });

  it("returns rejected when date is too old (older than 6 months)", () => {
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 7);

    const decision = determineVerificationStatus(
      highConfidenceReadableResult,
      false,
      oldDate
    );

    expect(decision.status).toBe("rejected");
    expect(decision.failureReason).toBe("RECEIPT_TOO_OLD");
    expect(decision.isDateTooOld).toBe(true);
    expect(decision.dateValidationMessage).toContain("older than 6 months");
  });

  it("uses custom maxAgeMonths from thresholds parameter", () => {
    const threeMonthOldDate = new Date();
    threeMonthOldDate.setMonth(threeMonthOldDate.getMonth() - 4);

    const decisionWithDefault = determineVerificationStatus(
      highConfidenceReadableResult,
      false,
      threeMonthOldDate
    );
    expect(decisionWithDefault.status).toBe("verified");

    const decisionWithShorterAge = determineVerificationStatus(
      highConfidenceReadableResult,
      false,
      threeMonthOldDate,
      { maxAgeMonths: 3 }
    );
    expect(decisionWithShorterAge.status).toBe("rejected");
    expect(decisionWithShorterAge.failureReason).toBe("RECEIPT_TOO_OLD");
  });

  it("returns rejected for duplicate receipt", () => {
    const decision = determineVerificationStatus(highConfidenceReadableResult, true, recentDate);

    expect(decision.status).toBe("rejected");
    expect(decision.failureReason).toBe("DUPLICATE_RECEIPT");
  });

  it("returns requires_review for low confidence regardless of other fields", () => {
    const lowConfidenceResult: ParsedOcrResult = {
      ...highConfidenceReadableResult,
      confidence: 20,
    };

    const decision = determineVerificationStatus(lowConfidenceResult, false, recentDate);

    expect(decision.status).toBe("requires_review");
    expect(decision.failureReason).toBeNull();
  });

  it("returns requires_review when confidence is high but has failure reason", () => {
    const highConfidenceFailure: ParsedOcrResult = {
      ...highConfidenceReadableResult,
      failureReason: "IMAGE_UNCLEAR",
    };

    const decision = determineVerificationStatus(highConfidenceFailure, false, recentDate);

    expect(decision.status).toBe("requires_review");
    expect(decision.failureReason).toBe("IMAGE_UNCLEAR");
  });

  it("returns requires_review when confidence is high but not readable", () => {
    const notReadableResult: ParsedOcrResult = {
      ...highConfidenceReadableResult,
      receiptReadable: false,
    };

    const decision = determineVerificationStatus(notReadableResult, false, recentDate);

    expect(decision.status).toBe("requires_review");
  });

  it("returns requires_review when confidence is high but missing shop name", () => {
    const missingShopResult: ParsedOcrResult = {
      ...highConfidenceReadableResult,
      extractedShopName: null,
    };

    const decision = determineVerificationStatus(missingShopResult, false, recentDate);

    expect(decision.status).toBe("requires_review");
  });

  it("returns requires_review when confidence is high but missing date", () => {
    const decision = determineVerificationStatus(
      highConfidenceReadableResult,
      false,
      null
    );

    expect(decision.status).toBe("requires_review");
  });

  it("uses custom threshold from thresholds parameter", () => {
    const result: ParsedOcrResult = {
      ...highConfidenceReadableResult,
      confidence: 60,
    };

    const decisionWithDefault = determineVerificationStatus(result, false, recentDate);
    expect(decisionWithDefault.status).toBe("requires_review");

    const decisionWithLowerThreshold = determineVerificationStatus(
      result,
      false,
      recentDate,
      { highConfidence: 50 }
    );
    expect(decisionWithLowerThreshold.status).toBe("verified");
  });
});

// ─── Tests: callOcrApi ─────────────────────────────────────────────────────────

describe("callOcrApi", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns success with response on successful API call", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: VALID_OCR_JSON } }] }),
    } as unknown as Response;

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const config = createMockOcrApiConfig();
    const messages = buildOcrMessages(Buffer.from("test"), TEST_OCR_PROMPT);

    const result = await callOcrApi(messages, config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.response).toBe(mockResponse);
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.test.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        }),
      })
    );
  });

  it("returns error when API responds with non-ok status", async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limit exceeded"),
    } as unknown as Response;

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const config = createMockOcrApiConfig();
    const messages = buildOcrMessages(Buffer.from("test"), TEST_OCR_PROMPT);

    const result = await callOcrApi(messages, config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("429");
    }
  });
});

// ─── Tests: processReceiptOcr ──────────────────────────────────────────────────

describe("processReceiptOcr", () => {
  let dependencies: ReturnType<typeof createMockDependencies>;
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    dependencies = createMockDependencies();
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    process.env.AI_API_KEY = "test-key";
    process.env.AI_API_BASE_URL = "https://api.test.com/v1";
    process.env.AI_MODEL_NAME = "gpt-5.4-nano";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("returns success with verification status on full pipeline", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(SAMPLE_RECEIPT as any);
    dependencies.database.receipt.update.mockResolvedValue({} as any);

    const mockApiResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: VALID_OCR_JSON } }],
      }),
    } as unknown as Response;

    globalThis.fetch = vi.fn().mockResolvedValue(mockApiResponse);

    const result = await processReceiptOcr(dependencies as OcrServiceDependencies, RECEIPT_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.verificationStatus).toBeDefined();
    }

    expect(dependencies.database.receipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RECEIPT_ID },
        data: expect.objectContaining({
          extractedShopName: "Albert Heijn",
          ocrConfidence: 85,
          receiptReadable: true,
        }),
      })
    );
  });

  it("returns error when receipt is not found", async () => {
    dependencies.database.receipt.findUnique.mockResolvedValue(null);

    const result = await processReceiptOcr(dependencies as OcrServiceDependencies, "nonexistent");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Receipt not found");
    }
  });
});

// ─── Tests: createOcrApiConfig ─────────────────────────────────────────────────

describe("createOcrApiConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.AI_API_BASE_URL = "https://env-api.example.com/v1";
    process.env.AI_API_KEY = "env-api-key";
    process.env.AI_MODEL_NAME = "env-model";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses defaults from environment variables", () => {
    const config = createOcrApiConfig();

    expect(config.baseUrl).toBe("https://env-api.example.com/v1");
    expect(config.apiKey).toBe("env-api-key");
    expect(config.model).toBe("env-model");
    expect(config.streaming).toBe(false);
  });

  it("applies overrides over environment defaults", () => {
    const config = createOcrApiConfig({
      baseUrl: "https://custom.api.com/v1",
      apiKey: "custom-key",
      model: "custom-model",
      streaming: true,
    });

    expect(config.baseUrl).toBe("https://custom.api.com/v1");
    expect(config.apiKey).toBe("custom-key");
    expect(config.model).toBe("custom-model");
    expect(config.streaming).toBe(true);
  });
});
