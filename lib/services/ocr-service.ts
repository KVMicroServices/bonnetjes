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
  getOcrPromptCriteria,
  getSecondaryPromptCriteria,
  getReceiptMaxAgeMonths,
} from "@/lib/services/app-settings-service";
import { recordAuditEvent } from "@/lib/services/audit-log-service";
import {
  FAILURE_REASONS,
  buildOcrPromptWithDynamicReasons,
  buildSecondaryPrompt,
} from "@/lib/services/ocr-constants";
import { getEnabledFailureReasonsWithDescriptions } from "@/lib/services/failure-reason-service";
import type { FailureReason } from "@/lib/services/ocr-constants";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-5.4-nano";
const DEFAULT_SECONDARY_AI_MODEL = "gpt-5.4-mini";
const MAX_TOKENS = 2000;
const HIGH_CONFIDENCE_THRESHOLD = 70;
const DEFAULT_MAX_AGE_MONTHS = 6;

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

// ─── Re-exports ──────────────────────────────────────────────────────────────

// Re-export from constants for backward compatibility
export { FAILURE_REASONS, buildOcrPrompt, buildOcrPromptWithDynamicReasons, buildSecondaryPrompt, OCR_PROMPT_DEFAULT_CRITERIA, SECONDARY_PROMPT_DEFAULT_CRITERIA } from "@/lib/services/ocr-constants";
export type { FailureReason } from "@/lib/services/ocr-constants";

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
  ocrPrompt: string
): ReadonlyArray<OcrMessage> {
  const base64Content = fileBuffer.toString("base64");
  const mimeType = "image/jpeg";
  const dataUri = `data:${mimeType};base64,${base64Content}`;

  const messages: OcrMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: ocrPrompt },
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
  _config: OcrApiConfig,
  ocrPrompt: string
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
        { type: "text", text: ocrPrompt }
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
          { type: "text", text: ocrPrompt },
          { type: "image_url", image_url: { url: dataUri } }
        ]
      }
    ];
  }

  if (!isPdf) {
    return buildOcrMessages(fileBuffer, ocrPrompt);
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
    { type: "text", text: ocrPrompt }
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
export function parseOcrResult(rawJson: string, allowedReasons?: readonly string[] | null): ParsedOcrResult {
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

  let validReasons: readonly string[];
  if (allowedReasons) {
    validReasons = allowedReasons;
  } else {
    validReasons = FAILURE_REASONS;
  }

  let failureReason: FailureReason | null = null;
  if (parsed.failureReason && validReasons.includes(parsed.failureReason as FailureReason)) {
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
  thresholds?: { highConfidence?: number; maxAgeMonths?: number }
): VerificationDecision {
  let confidenceThreshold = HIGH_CONFIDENCE_THRESHOLD;
  if (thresholds && thresholds.highConfidence !== undefined) {
    confidenceThreshold = thresholds.highConfidence;
  }
  let maxAgeMonths = DEFAULT_MAX_AGE_MONTHS;
  if (thresholds && thresholds.maxAgeMonths !== undefined) {
    maxAgeMonths = thresholds.maxAgeMonths;
  }

  let isDateTooOld = false;
  let dateValidationMessage = "";

  if (receiptDate) {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - maxAgeMonths);
    isDateTooOld = receiptDate < cutoffDate;
    if (isDateTooOld) {
      dateValidationMessage = `Receipt is older than ${maxAgeMonths} months and cannot be accepted.`;
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
  config: OcrApiConfig,
  customSecondaryCriteria: string | null
): Promise<SecondaryAnalysisResult | null> {
  let dateString = "null";
  if (ocrResult.extractedDate) {
    dateString = ocrResult.extractedDate.toISOString().split("T")[0];
  }

  let amountString = "null";
  if (ocrResult.extractedAmount !== null) {
    amountString = String(ocrResult.extractedAmount);
  }

  const fullSecondaryPrompt = buildSecondaryPrompt(customSecondaryCriteria);

  let shopNameForPrompt: string;
  if (ocrResult.extractedShopName) {
    shopNameForPrompt = ocrResult.extractedShopName;
  } else {
    shopNameForPrompt = "null";
  }

  const filledPrompt = fullSecondaryPrompt
    .replace("{shopName}", shopNameForPrompt)
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

  let secondaryModel: string;
  if (process.env.SECONDARY_AI_MODEL_NAME) {
    secondaryModel = process.env.SECONDARY_AI_MODEL_NAME;
  } else {
    secondaryModel = DEFAULT_SECONDARY_AI_MODEL;
  }

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

/** Build the OCR prompt, always appending dynamic failure reasons from DB. */
async function buildDynamicOcrPrompt(): Promise<string> {
  const customCriteria = await getOcrPromptCriteria();

  let dynamicReasons: ReadonlyArray<{ code: string; description: string }> | null = null;
  try {
    dynamicReasons = await getEnabledFailureReasonsWithDescriptions();
  } catch (error) {
    logger.warn({ error }, "Failed to load dynamic failure reasons for OCR prompt, falling back to hardcoded list");
  }

  return buildOcrPromptWithDynamicReasons(customCriteria, dynamicReasons);
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

  let fileType: string;
  if (receipt.fileType) {
    fileType = receipt.fileType;
  } else {
    fileType = "image";
  }
  let originalFilename: string;
  if (receipt.originalFilename) {
    originalFilename = receipt.originalFilename;
  } else {
    originalFilename = "receipt";
  }

  let aiBaseUrl: string;
  if (process.env.AI_API_BASE_URL) {
    aiBaseUrl = process.env.AI_API_BASE_URL;
  } else {
    aiBaseUrl = DEFAULT_AI_BASE_URL;
  }
  let aiModel: string;
  if (process.env.AI_MODEL_NAME) {
    aiModel = process.env.AI_MODEL_NAME;
  } else {
    aiModel = DEFAULT_AI_MODEL;
  }
  let aiApiKey: string;
  if (process.env.AI_API_KEY) {
    aiApiKey = process.env.AI_API_KEY;
  } else {
    aiApiKey = "";
  }

  const config: OcrApiConfig = {
    baseUrl: aiBaseUrl,
    apiKey: aiApiKey,
    model: aiModel,
    streaming: false
  };

  const messages = await buildOcrMessagesWithFileUpload(fileBuffer, fileType, originalFilename, config, await buildDynamicOcrPrompt());

  const apiResult = await callOcrApi(messages, config);

  if (!apiResult.success) {
    return { success: false, error: apiResult.error };
  }

  const llmResponse = await apiResult.response.json();
  const rawContent: string = llmResponse.choices[0].message.content;

  let allowedReasons: readonly string[] | null = null;
  try {
    const enabledReasons = await getEnabledFailureReasonsWithDescriptions();
    allowedReasons = enabledReasons.map((reason) => reason.code);
  } catch (error) {
    logger.warn({ error }, "Failed to load enabled failure reasons for parsing, allowing all built-in reasons");
  }
  const ocrResult = parseOcrResult(rawContent, allowedReasons);

  const highConfidence = await getHighConfidenceThreshold();
  const maxAgeMonths = await getReceiptMaxAgeMonths();

  const verificationDecision = determineVerificationStatus(
    ocrResult,
    receipt.isDuplicate,
    ocrResult.extractedDate,
    { highConfidence, maxAgeMonths }
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
      config,
      await getSecondaryPromptCriteria()
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
          { highConfidence, maxAgeMonths }
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

  let manipulationScore: number;
  if (receipt.manipulationScore) {
    manipulationScore = receipt.manipulationScore;
  } else {
    manipulationScore = 0;
  }

  const newFraudRiskScore = dependencies.fraudDetection.calculateFraudRiskScore(
    receipt.isDuplicate,
    manipulationScore,
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
  let baseUrl: string;
  if (overrides && overrides.baseUrl) {
    baseUrl = overrides.baseUrl;
  } else if (process.env.AI_API_BASE_URL) {
    baseUrl = process.env.AI_API_BASE_URL;
  } else {
    baseUrl = DEFAULT_AI_BASE_URL;
  }

  let apiKey: string;
  if (overrides && overrides.apiKey) {
    apiKey = overrides.apiKey;
  } else if (process.env.AI_API_KEY) {
    apiKey = process.env.AI_API_KEY;
  } else {
    apiKey = "";
  }

  let model: string;
  if (overrides && overrides.model) {
    model = overrides.model;
  } else if (process.env.AI_MODEL_NAME) {
    model = process.env.AI_MODEL_NAME;
  } else {
    model = DEFAULT_AI_MODEL;
  }

  let streaming = false;
  if (overrides && overrides.streaming !== undefined) {
    streaming = overrides.streaming;
  }

  return { baseUrl, apiKey, model, streaming };
}
