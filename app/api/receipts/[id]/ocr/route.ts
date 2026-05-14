export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getFileAsBuffer } from "@/lib/s3";
import { calculateFraudRiskScore, detectSuspiciousPatterns } from "@/lib/fraud-detection";

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
  callOcrApi,
  createOcrApiConfig,
  parseOcrResult,
  determineVerificationStatus,
  runSecondaryAnalysis,
} from "@/lib/services/ocr-service";

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
    const messages = await buildOcrMessagesWithFileUpload(
      fileBuffer,
      fileType,
      originalFilename,
      config
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
                      ocrResult.extractedDate
                    );

                    // Run secondary analysis on rejections
                    let secondaryAnalysis: string | null = null;
                    if (verificationDecision.status === "rejected" && verificationDecision.failureReason) {
                      secondaryAnalysis = await runSecondaryAnalysis(
                        messages,
                        ocrResult,
                        verificationDecision.failureReason,
                        config
                      );
                    }

                    // Update suspicious patterns with extracted data
                    const patternAnalysis = await detectSuspiciousPatterns(
                      receipt.userId,
                      ocrResult.extractedShopName,
                      ocrResult.extractedAmount
                    );

                    // Update fraud risk score with OCR confidence
                    const newFraudRiskScore = calculateFraudRiskScore(
                      receipt.isDuplicate,
                      receipt.manipulationScore ?? 0,
                      patternAnalysis.riskScore,
                      ocrResult.confidence ?? 100
                    );

                    let ocrReasoning = ocrResult.reasoning;
                    if (verificationDecision.isDateTooOld) {
                      ocrReasoning = `${ocrResult.reasoning} | ${verificationDecision.dateValidationMessage}`;
                    }

                    // Update receipt in database
                    await prisma.receipt.update({
                      where: { id },
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

                    const finalData = JSON.stringify({
                      status: "completed",
                      result: {
                        extractedShopName: ocrResult.extractedShopName,
                        extractedDate: ocrResult.extractedDate ? ocrResult.extractedDate.toISOString().split("T")[0] : null,
                        extractedAmount: ocrResult.extractedAmount,
                        receiptReadable: ocrResult.receiptReadable,
                        confidence: ocrResult.confidence,
                        reasoning: ocrResult.reasoning,
                        failureReason: verificationDecision.failureReason,
                        secondaryAnalysis,
                        isDateTooOld: verificationDecision.isDateTooOld,
                        dateValidationMessage: verificationDecision.dateValidationMessage,
                        fraudRiskScore: newFraudRiskScore,
                        verificationStatus: verificationDecision.status
                      }
                    });
                    controller.enqueue(
                      encoder.encode(`data: ${finalData}\n\n`)
                    );
                  } catch (parseError) {
                    console.error("Parse error:", parseError);
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
                  buffer += parsed.choices?.[0]?.delta?.content || "";
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
          console.error("Stream error:", error);
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
    console.error("OCR error:", error);
    return NextResponse.json(
      { error: "Failed to process receipt" },
      { status: 500 }
    );
  }
}
