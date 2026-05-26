export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { generateDisputePresignedUploadUrl, getFileAsBuffer } from "@/lib/s3";
import {
  calculateImageHash,
  checkForDuplicates,
  analyzeMetadata,
  detectSuspiciousPatterns,
  calculateFraudRiskScore,
} from "@/lib/fraud-detection";
import {
  buildOcrMessagesWithFileUpload,
  callOcrApi,
  createOcrApiConfig,
  parseOcrResult,
  determineVerificationStatus,
  runSecondaryAnalysis,
  buildOcrPromptWithDynamicReasons,
  type OcrApiConfig,
  type OcrMessage,
  type ParsedOcrResult,
  type FailureReason,
} from "@/lib/services/ocr-service";
import {
  verifyDisputeReceipt,
  findOriginalReceiptIdByReviewId,
  type DisputeOcrAdapter,
} from "@/lib/services/dispute-service";
import { resolveDisputeToken } from "@/lib/dispute/dispute-token-http";
import { recordAuditEvent } from "@/lib/services/audit-log-service";
import { sendNotification } from "@/lib/services/notification-service";
import {
  getOcrPromptCriteria,
  getSecondaryPromptCriteria,
  getHighConfidenceThreshold,
  getReceiptMaxAgeMonths,
} from "@/lib/services/app-settings-service";
import { getEnabledFailureReasonsWithDescriptions } from "@/lib/services/failure-reason-service";

const verifyRequestSchema = z.object({
  token: z.string().min(1),
  cloudStoragePath: z.string().min(1),
  originalFilename: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = verifyRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { token, cloudStoragePath, originalFilename, fileType, fileSize } = parseResult.data;

    const tokenResult = resolveDisputeToken(token);
    if (!tokenResult.success) {
      return tokenResult.response;
    }

    const ocrAdapter = createOcrAdapter();

    const result = await verifyDisputeReceipt(
      {
        database: prisma,
        storage: {
          generateDisputePresignedUploadUrl,
          getFileAsBuffer,
        },
        fraudDetection: {
          calculateImageHash,
          checkForDuplicates,
          analyzeMetadata,
          detectSuspiciousPatterns,
          calculateFraudRiskScore,
        },
      },
      ocrAdapter,
      {
        payload: tokenResult.payload,
        cloudStoragePath,
        originalFilename,
        fileType,
        fileSize,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode });
    }

    recordAuditEvent("system", "dispute_processed", undefined, {
      receiptId: result.receipt.id,
      outcome: result.receipt.verificationStatus,
    });

    const originalReceiptId = await findOriginalReceiptIdByReviewId(prisma, tokenResult.payload.reviewId);
    if (originalReceiptId) {
      recordAuditEvent("system", "dispute_processed", undefined, {
        receiptId: originalReceiptId,
        disputeReceiptId: result.receipt.id,
        reviewId: tokenResult.payload.reviewId,
        outcome: result.receipt.verificationStatus,
      });
    }

    let notificationReceiptId = result.receipt.id;
    if (originalReceiptId) {
      notificationReceiptId = originalReceiptId;
    }

    sendNotification({
      type: "dispute_received",
      title: "New dispute received",
      body: `A customer submitted a dispute for review ${tokenResult.payload.reviewId}. Outcome: ${result.receipt.verificationStatus}`,
      metadata: {
        receiptId: notificationReceiptId,
        disputeReceiptId: result.receipt.id,
        reviewId: tokenResult.payload.reviewId,
        verificationStatus: result.receipt.verificationStatus,
      },
    });

    return NextResponse.json(result.receipt);
  } catch (error) {
    logger.error({ error }, "Dispute verify error");
    return NextResponse.json({ error: "Failed to verify receipt" }, { status: 500 });
  }
}

function createOcrAdapter(): DisputeOcrAdapter {
  const config: OcrApiConfig = createOcrApiConfig({ streaming: false });
  let allowedReasonCodes: readonly string[] | null = null;

  return {
    async buildMessages(fileBuffer, fileType, originalFilename) {
      const customCriteria = await getOcrPromptCriteria();
      let dynamicReasons: ReadonlyArray<{ code: string; description: string }> | null = null;
      try {
        dynamicReasons = await getEnabledFailureReasonsWithDescriptions();
      } catch (error) {
        logger.warn({ error }, "Failed to load dynamic failure reasons for dispute OCR prompt");
      }
      if (dynamicReasons) {
        allowedReasonCodes = dynamicReasons.map((reason) => reason.code);
      }
      const ocrPrompt = buildOcrPromptWithDynamicReasons(customCriteria, dynamicReasons);
      return buildOcrMessagesWithFileUpload(fileBuffer, fileType, originalFilename, config, ocrPrompt);
    },
    async runOcr(messages) {
      const apiResult = await callOcrApi(messages as ReadonlyArray<OcrMessage>, config);
      if (!apiResult.success) {
        throw new Error(apiResult.error);
      }

      const llmResponse = await apiResult.response.json();
      const rawContent: string = llmResponse.choices[0].message.content;
      const parsed = parseOcrResult(rawContent, allowedReasonCodes);

      return {
        extractedShopName: parsed.extractedShopName,
        extractedDate: parsed.extractedDate,
        extractedAmount: parsed.extractedAmount,
        receiptReadable: parsed.receiptReadable,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        failureReason: parsed.failureReason,
      };
    },
    async decideStatus(parsed, isDuplicate) {
      const highConfidence = await getHighConfidenceThreshold();
      const maxAgeMonths = await getReceiptMaxAgeMonths();
      const decision = determineVerificationStatus(
        toParsedOcrResult(parsed),
        isDuplicate,
        parsed.extractedDate,
        { highConfidence, maxAgeMonths }
      );
      return {
        status: decision.status,
        failureReason: decision.failureReason,
        isDateTooOld: decision.isDateTooOld,
        dateValidationMessage: decision.dateValidationMessage,
      };
    },
    async runSecondary(messages, parsed, failureReason) {
      const customSecondaryCriteria = await getSecondaryPromptCriteria();
      const result = await runSecondaryAnalysis(
        messages as ReadonlyArray<OcrMessage>,
        toParsedOcrResult(parsed),
        failureReason as FailureReason,
        config,
        customSecondaryCriteria
      );
      return result;
    },
  };
}

function toParsedOcrResult(input: {
  extractedShopName: string | null;
  extractedDate: Date | null;
  extractedAmount: number | null;
  receiptReadable: boolean;
  confidence: number;
  reasoning: string;
  failureReason: string | null;
}): ParsedOcrResult {
  return {
    extractedShopName: input.extractedShopName,
    extractedDate: input.extractedDate,
    extractedAmount: input.extractedAmount,
    receiptReadable: input.receiptReadable,
    confidence: input.confidence,
    reasoning: input.reasoning,
    failureReason: input.failureReason as FailureReason | null,
  };
}


