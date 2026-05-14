import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const MAX_TOKENS = 2000;
const HIGH_CONFIDENCE_THRESHOLD = 70;
const LOW_CONFIDENCE_THRESHOLD = 30;
const OCR_REASONING_MAX_TOKENS = parseInt(process.env.OCR_REASONING_MAX_TOKENS || "150", 10);

const OCR_PROMPT = `You are a receipt verification expert. ALWAYS respond in English regardless of the language on the receipt.

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
   - MISSING_KEY_FIELDS: Some required fields (shop, date, amount) are completely absent

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

const SECONDARY_ANALYSIS_PROMPT = `You are a receipt verification quality assurance expert. ALWAYS respond in English.

A receipt was analyzed and REJECTED by the primary analysis. Your job is to review the rejection reasoning and either confirm it or provide additional nuance.

Primary analysis result:
- Confidence: {confidence}
- Readable: {readable}
- Failure reason: {failureReason}
- Reasoning: {reasoning}

Review the receipt image again and determine:
1. Is the initial rejection valid? If yes, respond with "Initial analysis valid"
2. If the rejection seems borderline or there are nuances worth noting, explain briefly what additional context might be relevant (e.g., partial data that could still be useful, specific areas that are unclear, etc.)

Respond with JSON in this exact format:
{
  "secondaryVerdict": "string - either 'Initial analysis valid' or a brief explanation of nuances (1-3 sentences, always in English)"
}

Respond with raw JSON only. All text must be in English.`;

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface StorageClient {
  getFileAsBuffer(cloudStoragePath: string): Promise<Buffer>;
}

export interface FraudDetectionClient {
  detectSuspiciousPatterns(
    userId: string,
    shopName: string | null | undefined,
    amount: number | null | undefined
  ): Promise<{ patterns: string[]; riskScore: number }>;
  calculateFraudRiskScore(
    isDuplicate: boolean,
    manipulationScore: number,
    patternRiskScore: number,
    ocrConfidence?: number
  ): number;
}

export interface OcrServiceDependencies {
  database: PrismaClient;
  storage: StorageClient;
  fraudDetection: FraudDetectionClient;
}

// ─── Configuration ───────────────────────────────────────────────────────────

export interface OcrApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  streaming: boolean;
}

// ─── Message Types ───────────────────────────────────────────────────────────

interface TextContent {
  type: "text";
  text: string;
}

interface ImageUrlContent {
  type: "image_url";
  image_url: { url: string };
}

interface FileContent {
  type: "file";
  file: { file_id: string };
}

type MessageContent = TextContent | ImageUrlContent | FileContent;

export interface OcrMessage {
  role: "user";
  content: ReadonlyArray<MessageContent>;
}

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

// ─── Result Types ────────────────────────────────────────────────────────────

export interface OcrExtractedResult {
  extractedShopName: string | null;
  extractedDate: string | null;
  extractedAmount: number | null;
  receiptReadable: boolean;
  confidence: number;
  reasoning: string;
  failureReason: FailureReason | null;
}

export interface ParsedOcrResult {
  extractedShopName: string | null;
  extractedDate: Date | null;
  extractedAmount: number | null;
  receiptReadable: boolean;
  confidence: number;
  reasoning: string;
  failureReason: FailureReason | null;
}

export interface SecondaryAnalysisResult {
  secondaryVerdict: string;
}

export type VerificationStatus = "pending" | "verified" | "rejected";

export interface VerificationDecision {
  status: VerificationStatus;
  failureReason: FailureReason | null;
  isDateTooOld: boolean;
  dateValidationMessage: string;
}

export type CallOcrApiResult =
  | { success: true; response: Response }
  | { success: false; error: string };

export type ProcessOcrResult =
  | { success: true; verificationStatus: string }
  | { success: false; error: string };

// ─── Service Functions ───────────────────────────────────────────────────────

/** Construct LLM messages for OCR extraction based on file type. */
export function buildOcrMessages(
  fileBuffer: Buffer,
  fileType: string,
  originalFilename: string
): ReadonlyArray<OcrMessage> {
  const base64Content = fileBuffer.toString("base64");
  const isPdf = fileType === "pdf" || originalFilename.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const mimeType = "application/pdf";
    const dataUri = `data:${mimeType};base64,${base64Content}`;
    const pdfPrompt = OCR_PROMPT + "\n\nNote: This is a PDF document provided as base64. Extract what information you can from the text content.";

    const messages: OcrMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: pdfPrompt },
          { type: "image_url", image_url: { url: dataUri } }
        ]
      }
    ];

    return messages;
  }

  const mimeType = "image/jpeg";
  const dataUri = `data:${mimeType};base64,${base64Content}`;

  const messages: OcrMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: OCR_PROMPT },
        { type: "image_url", image_url: { url: dataUri } }
      ]
    }
  ];

  return messages;
}

/** Build messages for PDF using the OpenAI Files API (upload-based approach). */
export async function buildOcrMessagesWithFileUpload(
  fileBuffer: Buffer,
  fileType: string,
  originalFilename: string,
  config: OcrApiConfig
): Promise<ReadonlyArray<OcrMessage>> {
  const isPdf = fileType === "pdf" || originalFilename.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    return buildOcrMessages(fileBuffer, fileType, originalFilename);
  }

  const fileBlob = new Blob([fileBuffer], { type: "application/pdf" });
  const formData = new FormData();
  formData.append("file", fileBlob, originalFilename || "receipt.pdf");
  formData.append("purpose", "assistants");

  const uploadResponse = await fetch(`${config.baseUrl}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData
  });

  if (!uploadResponse.ok) {
    return buildOcrMessages(fileBuffer, fileType, originalFilename);
  }

  const uploadData = await uploadResponse.json();
  const fileId: string = uploadData.id;

  const messages: OcrMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: OCR_PROMPT },
        { type: "file", file: { file_id: fileId } }
      ]
    }
  ];

  return messages;
}

/** Call the LLM API for OCR extraction. Returns the raw fetch Response. */
export async function callOcrApi(
  messages: ReadonlyArray<OcrMessage>,
  config: OcrApiConfig
): Promise<CallOcrApiResult> {
  const requestBody = {
    model: config.model,
    messages,
    max_completion_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    stream: config.streaming
  };

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody, model: config.model },
      "LLM API request failed"
    );
    return { success: false, error: `LLM API error: ${response.status}` };
  }

  return { success: true, response };
}

/** Parse raw JSON string from LLM into a structured OCR result. */
export function parseOcrResult(rawJson: string): ParsedOcrResult {
  const parsed: OcrExtractedResult = JSON.parse(rawJson);

  let extractedDate: Date | null = null;
  if (parsed.extractedDate) {
    extractedDate = new Date(parsed.extractedDate);
  }

  let extractedAmount: number | null = null;
  if (typeof parsed.extractedAmount === "number") {
    extractedAmount = parsed.extractedAmount;
  } else if (parsed.extractedAmount) {
    extractedAmount = parseFloat(String(parsed.extractedAmount));
  }

  let failureReason: FailureReason | null = null;
  if (parsed.failureReason && FAILURE_REASONS.includes(parsed.failureReason as FailureReason)) {
    failureReason = parsed.failureReason as FailureReason;
  }

  return {
    extractedShopName: parsed.extractedShopName,
    extractedDate,
    extractedAmount,
    receiptReadable: parsed.receiptReadable,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    failureReason
  };
}

/** Determine verification status based on OCR result, duplicate status, and date. */
export function determineVerificationStatus(
  ocrResult: ParsedOcrResult,
  isDuplicate: boolean,
  receiptDate: Date | null
): VerificationDecision {
  let isDateTooOld = false;
  let dateValidationMessage = "";

  if (receiptDate) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    isDateTooOld = receiptDate < sixMonthsAgo;
    if (isDateTooOld) {
      dateValidationMessage = "Receipt is older than 6 months and cannot be accepted.";
    }
  }

  if (isDateTooOld) {
    return { status: "rejected", failureReason: "RECEIPT_TOO_OLD", isDateTooOld, dateValidationMessage };
  }

  if (isDuplicate) {
    return { status: "rejected", failureReason: "DUPLICATE_RECEIPT", isDateTooOld, dateValidationMessage };
  }

  const hasHighConfidence = ocrResult.confidence >= HIGH_CONFIDENCE_THRESHOLD;
  const isReadable = ocrResult.receiptReadable;
  const hasShopName = ocrResult.extractedShopName !== null;
  const hasDate = receiptDate !== null;

  if (hasHighConfidence && isReadable && hasShopName && hasDate) {
    return { status: "verified", failureReason: null, isDateTooOld, dateValidationMessage };
  }

  const hasLowConfidence = ocrResult.confidence < LOW_CONFIDENCE_THRESHOLD;

  if (!isReadable || hasLowConfidence) {
    const failureReason = ocrResult.failureReason || "IMAGE_UNCLEAR";
    return { status: "rejected", failureReason, isDateTooOld, dateValidationMessage };
  }

  return { status: "pending", failureReason: null, isDateTooOld, dateValidationMessage };
}

/** Run a secondary AI analysis on a rejected receipt to confirm or add nuance. */
export async function runSecondaryAnalysis(
  messages: ReadonlyArray<OcrMessage>,
  ocrResult: ParsedOcrResult,
  failureReason: FailureReason,
  config: OcrApiConfig
): Promise<string> {
  const filledPrompt = SECONDARY_ANALYSIS_PROMPT
    .replace("{confidence}", String(ocrResult.confidence))
    .replace("{readable}", String(ocrResult.receiptReadable))
    .replace("{failureReason}", failureReason)
    .replace("{reasoning}", ocrResult.reasoning);

  const originalContent = messages[0].content;
  const secondaryMessages: OcrMessage[] = [
    {
      role: "user",
      content: [
        ...originalContent,
        { type: "text", text: filledPrompt }
      ]
    }
  ];

  const requestBody = {
    model: config.model,
    messages: secondaryMessages,
    max_completion_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    stream: false
  };

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "Secondary analysis API call failed");
      return "Secondary analysis unavailable";
    }

    const llmResponse = await response.json();
    const rawContent: string = llmResponse.choices[0].message.content;
    const parsed: SecondaryAnalysisResult = JSON.parse(rawContent);
    return parsed.secondaryVerdict;
  } catch (error) {
    logger.warn({ error }, "Secondary analysis parsing failed");
    return "Secondary analysis unavailable";
  }
}

/** Full OCR pipeline: fetch file, run OCR, update fraud scores, persist to database. */
export async function processReceiptOcr(
  dependencies: OcrServiceDependencies,
  receiptId: string
): Promise<ProcessOcrResult> {
  const receipt = await dependencies.database.receipt.findUnique({
    where: { id: receiptId }
  });

  if (!receipt) {
    return { success: false, error: "Receipt not found" };
  }

  const fileBuffer = await dependencies.storage.getFileAsBuffer(receipt.cloudStoragePath);

  const fileType = receipt.fileType || "image";
  const originalFilename = receipt.originalFilename || "receipt";

  const messages = buildOcrMessages(fileBuffer, fileType, originalFilename);

  const aiBaseUrl = process.env.AI_API_BASE_URL || DEFAULT_AI_BASE_URL;
  const aiModel = process.env.AI_MODEL_NAME || DEFAULT_AI_MODEL;
  const aiApiKey = process.env.AI_API_KEY || "";

  const config: OcrApiConfig = {
    baseUrl: aiBaseUrl,
    apiKey: aiApiKey,
    model: aiModel,
    streaming: false
  };

  const apiResult = await callOcrApi(messages, config);

  if (!apiResult.success) {
    return { success: false, error: apiResult.error };
  }

  const llmResponse = await apiResult.response.json();
  const rawContent: string = llmResponse.choices[0].message.content;

  const ocrResult = parseOcrResult(rawContent);

  const verificationDecision = determineVerificationStatus(
    ocrResult,
    receipt.isDuplicate,
    ocrResult.extractedDate
  );

  let secondaryAnalysis: string | null = null;
  if (verificationDecision.status === "rejected" && verificationDecision.failureReason) {
    secondaryAnalysis = await runSecondaryAnalysis(
      messages,
      ocrResult,
      verificationDecision.failureReason,
      config
    );
  }

  const patternAnalysis = await dependencies.fraudDetection.detectSuspiciousPatterns(
    receipt.userId,
    ocrResult.extractedShopName,
    ocrResult.extractedAmount
  );

  const newFraudRiskScore = dependencies.fraudDetection.calculateFraudRiskScore(
    receipt.isDuplicate,
    receipt.manipulationScore || 0,
    patternAnalysis.riskScore,
    ocrResult.confidence
  );

  let ocrReasoning = ocrResult.reasoning;
  if (verificationDecision.isDateTooOld) {
    ocrReasoning = `${ocrResult.reasoning} | ${verificationDecision.dateValidationMessage}`;
  }

  await dependencies.database.receipt.update({
    where: { id: receiptId },
    data: {
      extractedShopName: ocrResult.extractedShopName,
      extractedDate: ocrResult.extractedDate,
      extractedAmount: ocrResult.extractedAmount,
      ocrConfidence: ocrResult.confidence,
      ocrReasoning,
      receiptReadable: ocrResult.receiptReadable,
      failureReason: verificationDecision.failureReason,
      secondaryAnalysis,
      suspiciousPatterns: JSON.stringify(patternAnalysis.patterns),
      fraudRiskScore: newFraudRiskScore,
      verificationStatus: verificationDecision.status,
      processedAt: new Date()
    }
  });

  return { success: true, verificationStatus: verificationDecision.status };
}

/** Create an OcrApiConfig from environment variables with defaults. */
export function createOcrApiConfig(overrides?: Partial<OcrApiConfig>): OcrApiConfig {
  const baseUrl = overrides?.baseUrl || process.env.AI_API_BASE_URL || DEFAULT_AI_BASE_URL;
  const apiKey = overrides?.apiKey || process.env.AI_API_KEY || "";
  const model = overrides?.model || process.env.AI_MODEL_NAME || DEFAULT_AI_MODEL;
  const streaming = overrides?.streaming !== undefined ? overrides.streaming : false;

  return { baseUrl, apiKey, model, streaming };
}
