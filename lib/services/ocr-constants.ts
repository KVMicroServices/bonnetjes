// ─── OCR Verification Constants ──────────────────────────────────────────────
// Shared between ocr-service.ts and admin settings route.
// This file must NOT import heavy dependencies (file-conversion, pdf-to-image, etc.)

const OCR_REASONING_MAX_TOKENS = parseInt(process.env.OCR_REASONING_MAX_TOKENS || "150", 10);

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
7. If this is NOT a valid receipt or cannot be verified, provide a failure reason from this exact list:
   - NOT_A_RECEIPT: The image is not a purchase receipt
   - IMAGE_UNCLEAR: The image is too blurry, dark, or damaged to read
   - INSUFFICIENT_INFO: The receipt lacks key information (shop name, date, or amount)
   - UNREADABLE_TEXT: Text is present but cannot be reliably extracted
   - MISSING_KEY_FIELDS: Some required fields (shop, date, amount) are completely absent`;

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
  const criteria = (customCriteria && customCriteria.trim().length > 0)
    ? customCriteria.trim()
    : OCR_PROMPT_DEFAULT_CRITERIA;
  return criteria + OCR_PROMPT_RESPONSE_FORMAT;
}

/** Build the full secondary analysis prompt by combining criteria (custom or default) with the fixed response format. */
export function buildSecondaryPrompt(customCriteria: string | null): string {
  const criteria = (customCriteria && customCriteria.trim().length > 0)
    ? customCriteria.trim()
    : SECONDARY_PROMPT_DEFAULT_CRITERIA;
  return criteria + SECONDARY_PROMPT_RESPONSE_FORMAT;
}
