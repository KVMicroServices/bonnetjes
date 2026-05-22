import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupFetchMock, createJsonResponse, createErrorResponse, createNetworkError } from "../helpers";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

const mockFetch = setupFetchMock();

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { translateDescription, generateDescriptionFromCode } from "@/lib/services/failure-reason-translator";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createSuccessfulTranslationResponse() {
  return createJsonResponse({
    choices: [
      {
        message: {
          content: JSON.stringify({
            nl: "Nederlandse vertaling",
            de: "Deutsche Übersetzung",
            fr: "Traduction française",
            es: "Traducción española",
            af: "Afrikaanse vertaling",
            xh: "Inguqulelo yesiXhosa",
            zu: "Ukuhumusha kwesiZulu",
          }),
        },
      },
    ],
  });
}

function createSuccessfulGenerationResponse(description: string) {
  return createJsonResponse({
    choices: [
      {
        message: {
          content: description,
        },
      },
    ],
  });
}

// ─── Tests: translateDescription ───────────────────────────────────────────────

describe("translateDescription", () => {
  beforeEach(() => {
    process.env.AI_API_BASE_URL = "https://api.test.com/v1";
    process.env.AI_API_KEY = "test-api-key";
    process.env.AI_MODEL_NAME = "test-model";
  });

  it("sends the correct prompt structure to the AI API", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessfulTranslationResponse());

    await translateDescription("The receipt is from a different store");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArguments = mockFetch.mock.calls[0];
    const requestUrl = callArguments[0];
    const requestOptions = callArguments[1];
    const requestBody = JSON.parse(requestOptions.body);

    expect(requestUrl).toBe("https://api.test.com/v1/chat/completions");
    expect(requestOptions.headers["Authorization"]).toBe("Bearer test-api-key");
    expect(requestBody.model).toBe("test-model");
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.messages[0].role).toBe("system");
    expect(requestBody.messages[1].role).toBe("user");
    expect(requestBody.messages[1].content).toBe("The receipt is from a different store");
    expect(requestBody.response_format).toEqual({ type: "json_object" });
  });

  it("parses a valid translation response and returns success", async () => {
    mockFetch.mockResolvedValueOnce(createSuccessfulTranslationResponse());

    const result = await translateDescription("Test description");

    expect(result.success).toBe(true);
    expect(result.translations).not.toBeNull();
    expect(result.translations?.nl).toBe("Nederlandse vertaling");
    expect(result.translations?.de).toBe("Deutsche Übersetzung");
    expect(result.translations?.fr).toBe("Traduction française");
    expect(result.translations?.es).toBe("Traducción española");
    expect(result.translations?.af).toBe("Afrikaanse vertaling");
    expect(result.translations?.xh).toBe("Inguqulelo yesiXhosa");
    expect(result.translations?.zu).toBe("Ukuhumusha kwesiZulu");
  });

  it("returns failure on network error", async () => {
    mockFetch.mockRejectedValueOnce(createNetworkError("Connection refused"));

    const result = await translateDescription("Test description");

    expect(result.success).toBe(false);
    expect(result.translations).toBeNull();
    expect(result.error).toBe("Connection refused");
  });

  it("returns failure on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(createErrorResponse(500, "Internal Server Error"));

    const result = await translateDescription("Test description");

    expect(result.success).toBe(false);
    expect(result.translations).toBeNull();
    expect(result.error).toBe("AI API error: 500");
  });

  it("returns failure when response JSON is missing required locale translations", async () => {
    const incompleteResponse = createJsonResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              nl: "Dutch",
              de: "German",
              // Missing fr, es, af, xh, zu
            }),
          },
        },
      ],
    });
    mockFetch.mockResolvedValueOnce(incompleteResponse);

    const result = await translateDescription("Test description");

    expect(result.success).toBe(false);
    expect(result.translations).toBeNull();
    expect(result.error).toContain("missing one or more required translations");
  });

  it("returns failure when response content is not valid JSON", async () => {
    const invalidJsonResponse = createJsonResponse({
      choices: [
        {
          message: {
            content: "This is not JSON",
          },
        },
      ],
    });
    mockFetch.mockResolvedValueOnce(invalidJsonResponse);

    const result = await translateDescription("Test description");

    expect(result.success).toBe(false);
    expect(result.translations).toBeNull();
  });

  it("returns failure when response is missing content field", async () => {
    const noContentResponse = createJsonResponse({
      choices: [
        {
          message: {},
        },
      ],
    });
    mockFetch.mockResolvedValueOnce(noContentResponse);

    const result = await translateDescription("Test description");

    expect(result.success).toBe(false);
    expect(result.translations).toBeNull();
    expect(result.error).toBe("Response missing content");
  });
});

// ─── Tests: generateDescriptionFromCode ────────────────────────────────────────

describe("generateDescriptionFromCode", () => {
  beforeEach(() => {
    process.env.AI_API_BASE_URL = "https://api.test.com/v1";
    process.env.AI_API_KEY = "test-api-key";
    process.env.AI_MODEL_NAME = "test-model";
  });

  it("returns trimmed content on success", async () => {
    mockFetch.mockResolvedValueOnce(
      createSuccessfulGenerationResponse("  The receipt is from a different store  ")
    );

    const result = await generateDescriptionFromCode("WRONG_STORE");

    expect(result).toBe("The receipt is from a different store");
  });

  it("sends the code as the user message", async () => {
    mockFetch.mockResolvedValueOnce(
      createSuccessfulGenerationResponse("Generated description")
    );

    await generateDescriptionFromCode("WRONG_STORE");

    const callArguments = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArguments[1].body);

    expect(requestBody.messages[1].content).toBe("WRONG_STORE");
    expect(requestBody.messages[0].role).toBe("system");
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(createNetworkError("Connection timeout"));

    await expect(generateDescriptionFromCode("WRONG_STORE")).rejects.toThrow(
      "AI API network error: Connection timeout"
    );
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(createErrorResponse(429, "Rate limited"));

    await expect(generateDescriptionFromCode("WRONG_STORE")).rejects.toThrow(
      "AI API error: 429"
    );
  });

  it("throws when response is missing content", async () => {
    const noContentResponse = createJsonResponse({
      choices: [{ message: {} }],
    });
    mockFetch.mockResolvedValueOnce(noContentResponse);

    await expect(generateDescriptionFromCode("WRONG_STORE")).rejects.toThrow(
      "AI API response missing content"
    );
  });
});
