import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TranslationResult {
  success: boolean;
  translations: {
    nl: string | null;
    de: string | null;
    fr: string | null;
    es: string | null;
    af: string | null;
    xh: string | null;
    zu: string | null;
  } | null;
  error?: string;
}

interface AiTranslationResponse {
  nl: string;
  de: string;
  fr: string;
  es: string;
  af: string;
  xh: string;
  zu: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-5.4-nano";
const MAX_TOKENS = 1000;
const REQUEST_TIMEOUT_MILLISECONDS = 30000;

const TARGET_LOCALES: ReadonlyArray<string> = ["nl", "de", "fr", "es", "af", "xh", "zu"];

const TRANSLATION_SYSTEM_PROMPT = `You are a professional translator. Translate the given English text into the following languages: Dutch (nl), German (de), French (fr), Spanish (es), Afrikaans (af), Xhosa (xh), and Zulu (zu).

The text is a failure reason description used in customer-facing rejection emails. Keep translations concise, professional, and natural-sounding in each language.

Respond with a JSON object containing exactly these keys: nl, de, fr, es, af, xh, zu. Each value must be the translated string.`;

const GENERATION_SYSTEM_PROMPT = `You are a technical writer. Given a failure reason code (uppercase with underscores), generate a clear, concise English description sentence suitable for use in customer-facing rejection emails.

The description should explain why a receipt was rejected in a professional and helpful tone. Keep it to one sentence, maximum 100 words.

Respond with only the description text, no JSON, no quotes, no extra formatting.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAiConfig(): { baseUrl: string; apiKey: string; model: string } {
  let baseUrl = process.env.AI_API_BASE_URL;
  if (!baseUrl) {
    baseUrl = DEFAULT_AI_BASE_URL;
  }
  let apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    apiKey = "";
  }
  let model = process.env.AI_MODEL_NAME;
  if (!model) {
    model = DEFAULT_AI_MODEL;
  }
  return { baseUrl, apiKey, model };
}

function validateTranslationResponse(parsed: unknown): parsed is AiTranslationResponse {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  const record = parsed as Record<string, unknown>;

  for (const locale of TARGET_LOCALES) {
    if (typeof record[locale] !== "string") {
      return false;
    }
    if (record[locale] === "") {
      return false;
    }
  }

  return true;
}

// ─── Service Functions ───────────────────────────────────────────────────────

/** Translate an English description into all 7 supported locales via the AI API. */
export async function translateDescription(description: string): Promise<TranslationResult> {
  const config = getAiConfig();

  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: description },
    ],
    max_completion_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
  };

  let response: Response;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MILLISECONDS);

  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = "Unknown network error";
    }
    logger.error(
      { error: errorMessage, description },
      "Translation AI API network error"
    );
    return { success: false, translations: null, error: errorMessage };
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody, description },
      "Translation AI API returned non-2xx response"
    );
    return {
      success: false,
      translations: null,
      error: `AI API error: ${response.status}`,
    };
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch (error) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = "JSON parse error";
    }
    logger.error(
      { error: errorMessage, description },
      "Translation AI API response JSON parse failed"
    );
    return { success: false, translations: null, error: errorMessage };
  }

  const typedBody = responseBody as { choices?: Array<{ message?: { content?: string } }> };
  let content: string | undefined;
  if (typedBody && typedBody.choices && typedBody.choices.length > 0) {
    const firstChoice = typedBody.choices[0];
    if (firstChoice && firstChoice.message) {
      content = firstChoice.message.content;
    }
  }

  if (!content) {
    logger.error(
      { responseBody, description },
      "Translation AI API response missing content"
    );
    return { success: false, translations: null, error: "Response missing content" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = "JSON parse error";
    }
    logger.error(
      { error: errorMessage, content, description },
      "Translation AI API content JSON parse failed"
    );
    return { success: false, translations: null, error: errorMessage };
  }

  if (!validateTranslationResponse(parsed)) {
    logger.error(
      { parsed, description },
      "Translation AI API response missing required locale translations"
    );
    return {
      success: false,
      translations: null,
      error: "Response missing one or more required translations",
    };
  }

  return {
    success: true,
    translations: {
      nl: parsed.nl,
      de: parsed.de,
      fr: parsed.fr,
      es: parsed.es,
      af: parsed.af,
      xh: parsed.xh,
      zu: parsed.zu,
    },
  };
}

/** Generate an English description from a failure reason code using the AI API. */
export async function generateDescriptionFromCode(code: string): Promise<string> {
  const config = getAiConfig();

  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: GENERATION_SYSTEM_PROMPT },
      { role: "user", content: code },
    ],
    max_completion_tokens: MAX_TOKENS,
  };

  let response: Response;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MILLISECONDS);

  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = "Unknown network error";
    }
    logger.error(
      { error: errorMessage, code },
      "Description generation AI API network error"
    );
    throw new Error(`AI API network error: ${errorMessage}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody, code },
      "Description generation AI API returned non-2xx response"
    );
    throw new Error(`AI API error: ${response.status}`);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch (error) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = "JSON parse error";
    }
    logger.error(
      { error: errorMessage, code },
      "Description generation AI API response JSON parse failed"
    );
    throw new Error(`AI API response parse error: ${errorMessage}`);
  }

  const typedBody = responseBody as { choices?: Array<{ message?: { content?: string } }> };
  let content: string | undefined;
  if (typedBody && typedBody.choices && typedBody.choices.length > 0) {
    const firstChoice = typedBody.choices[0];
    if (firstChoice && firstChoice.message) {
      content = firstChoice.message.content;
    }
  }

  if (!content) {
    logger.error(
      { responseBody, code },
      "Description generation AI API response missing content"
    );
    throw new Error("AI API response missing content");
  }

  return content.trim();
}
