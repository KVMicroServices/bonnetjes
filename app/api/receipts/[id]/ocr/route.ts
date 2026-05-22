export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getFileAsBuffer } from "@/lib/s3";
import { calculateFraudRiskScore, detectSuspiciousPatterns } from "@/lib/fraud-detection";
import { logger } from "@/lib/logger";

const KV_SYNC_PATH_PREFIX = "kv-sync:";

/** Fetches receipt file content, handling both R2 and KV S3 bucket paths. */
async function getReceiptFileBuffer(cloudStoragePath: string): Promise<Buffer> {
  if (cloudStoragePath.startsWith(KV_SYNC_PATH_PREFIX)) {
    const s3Key = cloudStoragePath.substring(KV_SYNC_PATH_PREFIX.length);
    const { loadSyncConfiguration } = await import("@/lib/receipt-sync/config");
    const { KvS3Client } = await import("@/lib/receipt-sync/kv-s3-client");

    const configuration = loadSyncConfiguration();
    if (!configuration || configuration.kvReceiptS3BucketName.length === 0) {
      throw new Error("KV S3 configuration missing — cannot fetch synced receipt");
    }

    const kvS3Client = new KvS3Client(configuration);
    return kvS3Client.getReceiptContent(s3Key);
  }

  return getFileAsBuffer(cloudStoragePath);
}
import {
  buildOcrMessagesWithFileUpload,
  buildOcrPromptWithDynamicReasons,
  callOcrApi,
  createOcrApiConfig,
  parseOcrResult,
  determineVerificationStatus,
  runSecondaryAnalysis,
  FAILURE_REASONS,
  type FailureReason,
} from "@/lib/services/ocr-service";
import {
  getOcrPromptCriteria,
  getSecondaryPromptCriteria,
  getHighConfidenceThreshold,
  getReceiptMaxAgeMonths,
} from "@/lib/services/app-settings-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const userId = (session.user as any).id;
    const isAdmin = (session.user as any).role === "admin";

    const receipt = await prisma.receipt.findUnique({
      where: { id }
    });

    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    if (!isAdmin && receipt.userId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get file content
    const fileBuffer = await getReceiptFileBuffer(receipt.cloudStoragePath);
    const fileType = receipt.fileType || "image";
    const originalFilename = receipt.originalFilename || "receipt";

    // Build messages using service (handles PDF upload fallback)
    const config = createOcrApiConfig({ streaming: true });
    const customCriteria = await getOcrPromptCriteria();

    let dynamicReasons: ReadonlyArray<{ code: string; description: string }> | null = null;
    try {
      const { getEnabledFailureReasonsWithDescriptions } = await import("@/lib/services/failure-reason-service");
      dynamicReasons = await getEnabledFailureReasonsWithDescriptions();
    } catch {
      // Fall back to no dynamic reasons
    }
    const ocrPrompt = buildOcrPromptWithDynamicReasons(customCriteria, dynamicReasons);

    // Fetch admin-configured thresholds before stream starts
    const highConfidence = await getHighConfidenceThreshold();
    const maxAgeMonths = await getReceiptMaxAgeMonths();

    const messages = await buildOcrMessagesWithFileUpload(
      fileBuffer,
      fileType,
      originalFilename,
      config,
      ocrPrompt
    );

    // Call LLM API with streaming
    const apiResult = await callOcrApi(messages, config);

    if (!apiResult.success) {
      throw new Error(apiResult.error);
    }

    const response = apiResult.response;

    // Stream response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    let buffer = "";
    let partialRead = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const readResult = await reader?.read();
            const done = readResult?.done || false;
            const value = readResult?.value;
            if (done) break;

            partialRead += decoder.decode(value, { stream: true });
            const lines = partialRead.split("\n");
            partialRead = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") {
                  try {
                    const ocrResult = parseOcrResult(buffer);

                    const verificationDecision = determineVerificationStatus(
                      ocrResult,
                      receipt.isDuplicate,
                      ocrResult.extractedDate,
                      { highConfidence, maxAgeMonths }
                    );

                    // Run secondary analysis on all non-verified, non-hard-rule outcomes
                    let secondaryAnalysis: string | null = null;
                    let finalStatus = verificationDecision.status;
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
                      let primaryFailureReason: string;
                      if (ocrResult.failureReason) {
                        primaryFailureReason = ocrResult.failureReason;
                      } else {
                        primaryFailureReason = "IMAGE_UNCLEAR";
                      }
                      const secondaryResult = await runSecondaryAnalysis(
                        messages,
                        ocrResult,
                        primaryFailureReason as FailureReason,
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
                          finalStatus = "rejected";
                          if (secondaryResult.failureReason && FAILURE_REASONS.includes(secondaryResult.failureReason as FailureReason)) {
                            finalFailureReason = secondaryResult.failureReason as FailureReason;
                          }
                        } else if (secondaryResult.verdict === "overturned_to_verified" || secondaryResult.verdict === "requires_review") {
                          const secondaryDecision = determineVerificationStatus(
                            {
                              extractedShopName: finalShopName,
                              extractedDate: finalDate,
                              extractedAmount: finalAmount,
                              receiptReadable: finalReadable,
                              confidence: finalConfidence,
                              reasoning: secondaryResult.reasoning,
                              failureReason: secondaryResult.failureReason as FailureReason | null,
                            },
                            receipt.isDuplicate,
                            finalDate,
                            { highConfidence, maxAgeMonths }
                          );
                          finalStatus = secondaryDecision.status;
                          finalFailureReason = secondaryDecision.failureReason;
                        }
                      }
                    }

                    // Update suspicious patterns with extracted data
                    const patternAnalysis = await detectSuspiciousPatterns(
                      receipt.userId,
                      finalShopName,
                      finalAmount
                    );

                    // Update fraud risk score with OCR confidence
                    const newFraudRiskScore = calculateFraudRiskScore(
                      receipt.isDuplicate,
                      receipt.manipulationScore ?? 0,
                      patternAnalysis.riskScore,
                      finalConfidence ?? 100
                    );

                    let ocrReasoning = ocrResult.reasoning;
                    if (verificationDecision.isDateTooOld) {
                      ocrReasoning = `${ocrResult.reasoning} | ${verificationDecision.dateValidationMessage}`;
                    }

                    // Update receipt in database
                    await prisma.receipt.update({
                      where: { id },
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
                        verificationStatus: finalStatus,
                        processedAt: new Date()
                      }
                    });

                    let extractedDateString: string | null = null;
                    if (finalDate) {
                      const isoString = finalDate.toISOString();
                      extractedDateString = isoString.split("T")[0];
                    }

                    const finalData = JSON.stringify({
                      status: "completed",
                      result: {
                        extractedShopName: finalShopName,
                        extractedDate: extractedDateString,
                        extractedAmount: finalAmount,
                        receiptReadable: finalReadable,
                        confidence: finalConfidence,
                        reasoning: ocrResult.reasoning,
                        failureReason: finalFailureReason,
                        secondaryAnalysis,
                        isDateTooOld: verificationDecision.isDateTooOld,
                        dateValidationMessage: verificationDecision.dateValidationMessage,
                        fraudRiskScore: newFraudRiskScore,
                        verificationStatus: finalStatus
                      }
                    });
                    controller.enqueue(
                      encoder.encode(`data: ${finalData}\n\n`)
                    );
                  } catch (parseError) {
                    logger.error({ error: parseError }, "Failed to parse OCR result in stream");
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          status: "error",
                          message: "Failed to parse OCR result"
                        })}\n\n`
                      )
                    );
                  }
                  return;
                }

                try {
                  const parsed = JSON.parse(data);
                  let deltaContent = "";
                  if (parsed.choices && parsed.choices.length > 0) {
                    const firstChoice = parsed.choices[0];
                    if (firstChoice && firstChoice.delta && firstChoice.delta.content) {
                      deltaContent = firstChoice.delta.content;
                    }
                  }
                  buffer += deltaContent;
                  const progressData = JSON.stringify({
                    status: "processing",
                    message: "Analyzing receipt..."
                  });
                  controller.enqueue(
                    encoder.encode(`data: ${progressData}\n\n`)
                  );
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        } catch (error) {
          logger.error({ error }, "Stream error during OCR processing");
          controller.error(error);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    logger.error({ error }, "OCR processing error");
    return NextResponse.json(
      { error: "Failed to process receipt" },
      { status: 500 }
    );
  }
}
