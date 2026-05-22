// ─── OCR Verification Constants ──────────────────────────────────────────────
// Shared between ocr-service.ts and admin settings route.
// This file must NOT import heavy dependencies (file-conversion, pdf-to-image, etc.)

const OCR_REASONING_MAX_TOKENS_ENV = process.env.OCR_REASONING_MAX_TOKENS;
let ocrReasoningMaxTokensRaw: string;
if (OCR_REASONING_MAX_TOKENS_ENV) {
  ocrReasoningMaxTokensRaw = OCR_REASONING_MAX_TOKENS_ENV;
} else {
  ocrReasoningMaxTokensRaw = "150";
}
const OCR_REASONING_MAX_TOKENS = parseInt(ocrReasoningMaxTokensRaw, 10);

// ─── Failure Reason Constants ─────────────────────────────────────────────────

export const FAILURE_REASONS = [
  "NOT_A_RECEIPT",
  "IMAGE_UNCLEAR",
  "INSUFFICIENT_INFO",
  "DUPLICATE_RECEIPT",
  "RECEIPT_TOO_OLD",
  "SUSPECTED_FRAUD",
  "UNREADABLE_TEXT",
  "MISSING_KEY_FIELDS"
] as const;

export type FailureReason = typeof FAILURE_REASONS[number];

// ─── Default Prompt Criteria ──────────────────────────────────────────────────

export const OCR_PROMPT_DEFAULT_CRITERIA = `You are a receipt verification expert. ALWAYS respond in English regardless of the language on the receipt.

Analyze this receipt and extract the following information:

1. Shop/Store name (the business name on the receipt)
2. Transaction date (format: YYYY-MM-DD)
3. Total amount (number only, without currency symbol)
4. Whether the receipt is clearly readable
5. Your confidence level (0-100)
6. Brief reasoning about your analysis in English (keep under ${OCR_REASONING_MAX_TOKENS} tokens)
7. If this is NOT a valid receipt or cannot be verified, provide a failure reason from the list below`;

export const SECONDARY_PROMPT_DEFAULT_CRITERIA = `You are a receipt verification quality assurance expert. ALWAYS respond in English.

A receipt was analyzed by the primary OCR model but the result was not confident enough to auto-verify. Your job is to independently review the receipt image alongside the primary model's analysis, then provide your own assessment.

Primary analysis result:
- Extracted shop name: {shopName}
- Extracted date: {date}
- Extracted amount: {amount}
- Confidence: {confidence}
- Readable: {readable}
- Failure reason: {failureReason}
- Reasoning: {reasoning}

Instructions:
1. Look at the receipt image yourself. Do NOT blindly trust the primary analysis.
2. Consider whether the primary model's assessment is justified given what you can see.
3. Provide your own independent extraction of the receipt data (shop name, date, amount).
4. Provide your own confidence score (0-100) based on what you can see.
5. Decide on a verdict:
   - "confirmed_rejection" if the receipt is clearly invalid or unreadable
   - "overturned_to_verified" if you can clearly read the receipt and extract valid data
   - "requires_review" if the receipt is borderline and needs human review
6. Provide a brief reasoning for your decision.`;

// ─── Response Format Blocks (fixed, not admin-editable) ──────────────────────

export const OCR_PROMPT_RESPONSE_FORMAT = `

Respond with JSON in this exact format:
{
  "extractedShopName": "string - shop name from receipt, or null if not found",
  "extractedDate": "YYYY-MM-DD or null if not found",
  "extractedAmount": number or null if not found,
  "receiptReadable": true/false,
  "confidence": 0-100,
  "reasoning": "1-2 sentences max, always in English",
  "failureReason": "one of the failure codes above, or null if receipt is valid"
}

Respond with raw JSON only. All text in your response must be in English.`;

export const SECONDARY_PROMPT_RESPONSE_FORMAT = `

Respond with JSON in this exact format:
{
  "verdict": "confirmed_rejection" | "overturned_to_verified" | "requires_review",
  "reasoning": "2-4 sentences explaining your decision, always in English",
  "extractedShopName": "string - shop name you extracted, or null if not found",
  "extractedDate": "YYYY-MM-DD or null if not found",
  "extractedAmount": number or null if not found,
  "receiptReadable": true/false,
  "confidence": 0-100,
  "failureReason": "one of: NOT_A_RECEIPT, IMAGE_UNCLEAR, INSUFFICIENT_INFO, UNREADABLE_TEXT, MISSING_KEY_FIELDS, or null if receipt is valid"
}

Respond with raw JSON only. All text must be in English.`;

// ─── Prompt Builders ─────────────────────────────────────────────────────────

/** Build the full OCR prompt by combining criteria (custom or default) with the fixed response format. */
export function buildOcrPrompt(customCriteria: string | null): string {
  let criteria: string;
  if (customCriteria && customCriteria.trim().length > 0) {
    criteria = customCriteria.trim();
  } else {
    criteria = OCR_PROMPT_DEFAULT_CRITERIA;
  }
  return criteria + OCR_PROMPT_RESPONSE_FORMAT;
}

/** Build the failure reason list block to append to any prompt. */
export function buildFailureReasonListBlock(reasons: ReadonlyArray<{ code: string; description: string }>): string {
  const reasonLines = reasons.map((reason) => `   - ${reason.code}: ${reason.description}`);
  const reasonList = reasonLines.join("\n");
  return `\n\nValid failure reasons:\n${reasonList}`;
}

/** Build the full OCR prompt with dynamic failure reasons always appended. */
export function buildOcrPromptWithDynamicReasons(customCriteria: string | null, reasons: ReadonlyArray<{ code: string; description: string }> | null): string {
  let criteria: string;
  if (customCriteria && customCriteria.trim().length > 0) {
    criteria = customCriteria.trim();
  } else {
    criteria = OCR_PROMPT_DEFAULT_CRITERIA;
  }

  let reasonBlock = "";
  if (reasons && reasons.length > 0) {
    reasonBlock = buildFailureReasonListBlock(reasons);
  }

  return criteria + reasonBlock + OCR_PROMPT_RESPONSE_FORMAT;
}

/** Build the full secondary analysis prompt by combining criteria (custom or default) with the fixed response format. */
export function buildSecondaryPrompt(customCriteria: string | null): string {
  let criteria: string;
  if (customCriteria && customCriteria.trim().length > 0) {
    criteria = customCriteria.trim();
  } else {
    criteria = SECONDARY_PROMPT_DEFAULT_CRITERIA;
  }
  return criteria + SECONDARY_PROMPT_RESPONSE_FORMAT;
}
