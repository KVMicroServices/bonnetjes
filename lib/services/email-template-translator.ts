import { logger } from "@/lib/logger";
import type { SupportedLocale } from "@/lib/i18n-config";
import { LOCALE_LABELS } from "@/lib/i18n-config";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmailTemplateTranslationResult {
  success: boolean;
  translations: Record<string, string>;
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-5.4-nano";
const MAX_TOKENS = 2000;
const REQUEST_TIMEOUT_MILLISECONDS = 30000;

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

function buildSystemPrompt(sourceLocale: SupportedLocale, targetLocales: ReadonlyArray<SupportedLocale>): string {
  const sourceLanguageName = LOCALE_LABELS[sourceLocale];
  const targetLanguageList = targetLocales
    .map((locale) => `${LOCALE_LABELS[locale]} (${locale})`)
    .join(", ");

  return `You are a professional translator. Translate the given ${sourceLanguageName} text into the following languages: ${targetLanguageList}.

The text is part of a transactional email template used in a customer-facing receipt verification platform. Keep translations concise, professional, and natural-sounding in each language. Preserve any placeholder tokens like {name} or {url} exactly as they appear.

Respond with a JSON object where each key is the locale code and each value is the translated string. Keys must be: ${targetLocales.join(", ")}.`;
}

function validateTranslationResponse(parsed: unknown, targetLocales: ReadonlyArray<SupportedLocale>): boolean {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  const record = parsed as Record<string, unknown>;

  for (const locale of targetLocales) {
    if (typeof record[locale] !== "string") {
      return false;
    }
    if (record[locale] === "") {
      return false;
    }
  }

  return true;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Translate a single email template value from the source locale to all target locales. */
export async function translateEmailTemplateEntry(
  value: string,
  sourceLocale: SupportedLocale,
  targetLocales: ReadonlyArray<SupportedLocale>
): Promise<EmailTemplateTranslationResult> {
  const config = getAiConfig();
  const systemPrompt = buildSystemPrompt(sourceLocale, targetLocales);

  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: value },
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
    logger.error({ error: errorMessage, value }, "Email template translation AI API network error");
    return { success: false, translations: {}, error: errorMessage };
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, body: errorBody }, "Email template translation AI API returned non-2xx response");
    return { success: false, translations: {}, error: `AI API error: ${response.status}` };
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
    logger.error({ error: errorMessage }, "Email template translation AI API response JSON parse failed");
    return { success: false, translations: {}, error: errorMessage };
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
    logger.error({ responseBody }, "Email template translation AI API response missing content");
    return { success: false, translations: {}, error: "Response missing content" };
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
    logger.error({ error: errorMessage, content }, "Email template translation AI API content JSON parse failed");
    return { success: false, translations: {}, error: errorMessage };
  }

  if (!validateTranslationResponse(parsed, targetLocales)) {
    logger.error({ parsed }, "Email template translation AI API response missing required locale translations");
    return { success: false, translations: {}, error: "Response missing one or more required translations" };
  }

  const translations: Record<string, string> = {};
  for (const locale of targetLocales) {
    translations[locale] = (parsed as Record<string, string>)[locale];
  }

  return { success: true, translations };
}
