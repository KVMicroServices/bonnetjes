import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { convertPdfToImages } from "@/lib/pdf-to-image";
import {
  needsConversion,
  convertForOcr,
  isDocFile,
} from "@/lib/file-conversion";
import {
  getHighConfidenceThreshold,
} from "@/lib/services/app-settings-service";
import { recordAuditEvent } from "@/lib/services/audit-log-service";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-5.4-nano";
const DEFAULT_SECONDARY_AI_MODEL = "gpt-5.4-mini";
const MAX_TOKENS = 2000;
const HIGH_CONFIDENCE_THRESHOLD = 70;
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
6. Provide a brief reasoning for your decision.

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

type MessageContent = TextContent | ImageUrlContent;

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

export type SecondaryVerdict = "confirmed_rejection" | "overturned_to_verified" | "requires_review";

export interface SecondaryAnalysisResult {
  verdict: SecondaryVerdict;
  reasoning: string;
  extractedShopName: string | null;
  extractedDate: string | null;
  extractedAmount: number | null;
  receiptReadable: boolean;
  confidence: number;
  failureReason: string | null;
}

const secondaryAnalysisResultSchema = z.object({
  verdict: z.enum(["confirmed_rejection", "overturned_to_verified", "requires_review"]),
  reasoning: z.string(),
  extractedShopName: z.string().nullable(),
  extractedDate: z.string().nullable(),
  extractedAmount: z.number().nullable(),
  receiptReadable: z.boolean(),
  confidence: z.number().min(0).max(100),
  failureReason: z.string().nullable(),
});

export type VerificationStatus = "pending" | "verified" | "rejected" | "requires_review";

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
  _fileType: string,
  _originalFilename: string
): ReadonlyArray<OcrMessage> {
  const base64Content = fileBuffer.toString("base64");
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

/** Build OCR messages, converting PDFs and unsupported formats to images first. */
export async function buildOcrMessagesWithFileUpload(
  fileBuffer: Buffer,
  fileType: string,
  originalFilename: string,
  _config: OcrApiConfig
): Promise<ReadonlyArray<OcrMessage>> {
  const isPdf = fileType === "pdf" || originalFilename.toLowerCase().endsWith(".pdf");
  const requiresConversion = needsConversion(originalFilename);

  // Handle HEIC, DOC, DOCX conversion
  if (requiresConversion) {
    const conversionResult = await convertForOcr(fileBuffer, originalFilename);

    if (!conversionResult.success) {
      logger.error(
        { error: conversionResult.error, filename: originalFilename },
        "File conversion failed, cannot process receipt"
      );
      throw new Error(`File conversion failed: ${conversionResult.error}`);
    }

    // DOC files are converted to PDF first, then need PDF→image pipeline
    if (isDocFile(originalFilename)) {
      const pdfConversionResult = await convertPdfToImages(conversionResult.buffer);

      if (!pdfConversionResult.success) {
        logger.error(
          { error: pdfConversionResult.error, filename: originalFilename },
          "DOC→PDF→image conversion failed"
        );
        throw new Error(`DOC conversion failed: ${pdfConversionResult.error}`);
      }

      if (pdfConversionResult.pages.length === 0) {
        throw new Error("DOC conversion produced no pages");
      }

      const imageContent: MessageContent[] = [
        { type: "text", text: OCR_PROMPT }
      ];

      for (const page of pdfConversionResult.pages) {
        const base64Content = page.pngBuffer.toString("base64");
        const dataUri = `data:image/png;base64,${base64Content}`;
        imageContent.push({ type: "image_url", image_url: { url: dataUri } });
      }

      return [{ role: "user", content: imageContent }];
    }

    // HEIC and DOCX produce a single image buffer directly
    const base64Content = conversionResult.buffer.toString("base64");
    const dataUri = `data:${conversionResult.mimeType};base64,${base64Content}`;

    return [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          { type: "image_url", image_url: { url: dataUri } }
        ]
      }
    ];
  }

  if (!isPdf) {
    return buildOcrMessages(fileBuffer, fileType, originalFilename);
  }

  const conversionResult = await convertPdfToImages(fileBuffer);

  if (!conversionResult.success) {
    logger.error(
      { error: conversionResult.error, filename: originalFilename },
      "PDF conversion failed, cannot process receipt"
    );
    throw new Error(`PDF conversion failed: ${conversionResult.error}`);
  }

  if (conversionResult.pages.length === 0) {
    throw new Error("PDF conversion produced no pages");
  }

  const imageContent: MessageContent[] = [
    { type: "text", text: OCR_PROMPT }
  ];

  for (const page of conversionResult.pages) {
    const base64Content = page.pngBuffer.toString("base64");
    const dataUri = `data:image/png;base64,${base64Content}`;
    imageContent.push({ type: "image_url", image_url: { url: dataUri } });
  }

  const messages: OcrMessage[] = [
    {
      role: "user",
      content: imageContent
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
  receiptDate: Date | null,
  thresholds?: { highConfidence?: number }
): VerificationDecision {
  const confidenceThreshold = thresholds?.highConfidence ?? HIGH_CONFIDENCE_THRESHOLD;

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

  const meetsThreshold = ocrResult.confidence >= confidenceThreshold;
  const isReadable = ocrResult.receiptReadable;
  const hasShopName = ocrResult.extractedShopName !== null;
  const hasDate = receiptDate !== null;
  const hasNoFailure = ocrResult.failureReason === null;

  if (meetsThreshold && hasNoFailure && isReadable && hasShopName && hasDate) {
    return { status: "verified", failureReason: null, isDateTooOld, dateValidationMessage };
  }

  return { status: "requires_review", failureReason: ocrResult.failureReason, isDateTooOld, dateValidationMessage };
}

/** Run a secondary AI analysis on a rejected receipt to confirm or add nuance. */
export async function runSecondaryAnalysis(
  messages: ReadonlyArray<OcrMessage>,
  ocrResult: ParsedOcrResult,
  failureReason: FailureReason,
  config: OcrApiConfig
): Promise<SecondaryAnalysisResult | null> {
  let dateString = "null";
  if (ocrResult.extractedDate) {
    dateString = ocrResult.extractedDate.toISOString().split("T")[0];
  }

  let amountString = "null";
  if (ocrResult.extractedAmount !== null) {
    amountString = String(ocrResult.extractedAmount);
  }

  const filledPrompt = SECONDARY_ANALYSIS_PROMPT
    .replace("{shopName}", ocrResult.extractedShopName || "null")
    .replace("{date}", dateString)
    .replace("{amount}", amountString)
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

  const secondaryModel = process.env.SECONDARY_AI_MODEL_NAME || DEFAULT_SECONDARY_AI_MODEL;

  const requestBody = {
    model: secondaryModel,
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
      return null;
    }

    const llmResponse = await response.json();
    const rawContent: string = llmResponse.choices[0].message.content;
    const rawParsed = JSON.parse(rawContent);
    const validationResult = secondaryAnalysisResultSchema.safeParse(rawParsed);

    if (!validationResult.success) {
      logger.warn({ errors: validationResult.error.issues }, "Secondary analysis failed schema validation");
      return null;
    }

    const parsed: SecondaryAnalysisResult = validationResult.data;

    return parsed;
  } catch (error) {
    logger.warn({ error }, "Secondary analysis parsing failed");
    return null;
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

  const aiBaseUrl = process.env.AI_API_BASE_URL || DEFAULT_AI_BASE_URL;
  const aiModel = process.env.AI_MODEL_NAME || DEFAULT_AI_MODEL;
  const aiApiKey = process.env.AI_API_KEY || "";

  const config: OcrApiConfig = {
    baseUrl: aiBaseUrl,
    apiKey: aiApiKey,
    model: aiModel,
    streaming: false
  };

  const messages = await buildOcrMessagesWithFileUpload(fileBuffer, fileType, originalFilename, config);

  const apiResult = await callOcrApi(messages, config);

  if (!apiResult.success) {
    return { success: false, error: apiResult.error };
  }

  const llmResponse = await apiResult.response.json();
  const rawContent: string = llmResponse.choices[0].message.content;

  const ocrResult = parseOcrResult(rawContent);

  const highConfidence = await getHighConfidenceThreshold();

  const verificationDecision = determineVerificationStatus(
    ocrResult,
    receipt.isDuplicate,
    ocrResult.extractedDate,
    { highConfidence }
  );

  let secondaryAnalysis: string | null = null;
  let finalVerificationStatus = verificationDecision.status;
  let finalFailureReason = verificationDecision.failureReason;
  let finalShopName = ocrResult.extractedShopName;
  let finalDate = ocrResult.extractedDate;
  let finalAmount = ocrResult.extractedAmount;
  let finalConfidence = ocrResult.confidence;
  let finalReadable = ocrResult.receiptReadable;

  const isHardRuleRejection = verificationDecision.failureReason === "DUPLICATE_RECEIPT"
    || verificationDecision.failureReason === "RECEIPT_TOO_OLD";
  const needsSecondaryAnalysis = verificationDecision.status !== "verified" && !isHardRuleRejection;

  if (needsSecondaryAnalysis) {
    let primaryFailureReason: FailureReason;
    if (ocrResult.failureReason) {
      primaryFailureReason = ocrResult.failureReason;
    } else {
      primaryFailureReason = "IMAGE_UNCLEAR";
    }
    const secondaryResult = await runSecondaryAnalysis(
      messages,
      ocrResult,
      primaryFailureReason,
      config
    );

    if (secondaryResult) {
      secondaryAnalysis = JSON.stringify(secondaryResult);

      if (secondaryResult.extractedShopName !== null) {
        finalShopName = secondaryResult.extractedShopName;
      }
      if (secondaryResult.extractedDate !== null) {
        finalDate = new Date(secondaryResult.extractedDate);
      }
      if (secondaryResult.extractedAmount !== null) {
        finalAmount = secondaryResult.extractedAmount;
      }
      finalConfidence = secondaryResult.confidence;
      finalReadable = secondaryResult.receiptReadable;

      if (secondaryResult.verdict === "confirmed_rejection") {
        finalVerificationStatus = "rejected";
        if (secondaryResult.failureReason && FAILURE_REASONS.includes(secondaryResult.failureReason as FailureReason)) {
          finalFailureReason = secondaryResult.failureReason as FailureReason;
        }
      } else if (secondaryResult.verdict === "overturned_to_verified" || secondaryResult.verdict === "requires_review") {
        const secondaryOcrResult: ParsedOcrResult = {
          extractedShopName: finalShopName,
          extractedDate: finalDate,
          extractedAmount: finalAmount,
          receiptReadable: finalReadable,
          confidence: finalConfidence,
          reasoning: secondaryResult.reasoning,
          failureReason: secondaryResult.failureReason as FailureReason | null,
        };

        const secondaryDecision = determineVerificationStatus(
          secondaryOcrResult,
          receipt.isDuplicate,
          finalDate,
          { highConfidence }
        );

        finalVerificationStatus = secondaryDecision.status;
        finalFailureReason = secondaryDecision.failureReason;
      }
    }
  }

  const patternAnalysis = await dependencies.fraudDetection.detectSuspiciousPatterns(
    receipt.userId,
    finalShopName,
    finalAmount
  );

  const newFraudRiskScore = dependencies.fraudDetection.calculateFraudRiskScore(
    receipt.isDuplicate,
    receipt.manipulationScore || 0,
    patternAnalysis.riskScore,
    finalConfidence
  );

  let ocrReasoning = ocrResult.reasoning;
  if (verificationDecision.isDateTooOld) {
    ocrReasoning = `${ocrResult.reasoning} | ${verificationDecision.dateValidationMessage}`;
  }

  await dependencies.database.receipt.update({
    where: { id: receiptId },
    data: {
      extractedShopName: finalShopName,
      extractedDate: finalDate,
      extractedAmount: finalAmount,
      ocrConfidence: finalConfidence,
      ocrReasoning,
      receiptReadable: finalReadable,
      failureReason: finalFailureReason,
      secondaryAnalysis,
      suspiciousPatterns: JSON.stringify(patternAnalysis.patterns),
      fraudRiskScore: newFraudRiskScore,
      verificationStatus: finalVerificationStatus,
      processedAt: new Date()
    }
  });

  recordAuditEvent("ai_judgement", finalVerificationStatus, undefined, {
    receiptId,
    verdict: finalVerificationStatus,
    confidence: finalConfidence,
  });

  if (secondaryAnalysis) {
    const parsedSecondary = JSON.parse(secondaryAnalysis) as SecondaryAnalysisResult;
    recordAuditEvent("secondary_analysis", parsedSecondary.verdict, undefined, {
      receiptId,
      verdict: parsedSecondary.verdict,
      confidence: parsedSecondary.confidence,
    });
  }

  return { success: true, verificationStatus: finalVerificationStatus };
}

/** Create an OcrApiConfig from environment variables with defaults. */
export function createOcrApiConfig(overrides?: Partial<OcrApiConfig>): OcrApiConfig {
  const baseUrl = overrides?.baseUrl || process.env.AI_API_BASE_URL || DEFAULT_AI_BASE_URL;
  const apiKey = overrides?.apiKey || process.env.AI_API_KEY || "";
  const model = overrides?.model || process.env.AI_MODEL_NAME || DEFAULT_AI_MODEL;
  let streaming = false;
  if (overrides?.streaming !== undefined) {
    streaming = overrides.streaming;
  }

  return { baseUrl, apiKey, model, streaming };
}
