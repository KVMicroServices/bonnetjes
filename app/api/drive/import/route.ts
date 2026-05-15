import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { generatePresignedUploadUrl } from "@/lib/s3";
import {
  calculateImageHash,
  checkForDuplicates,
  analyzeMetadata,
  detectSuspiciousPatterns,
  calculateFraudRiskScore
} from "@/lib/fraud-detection";
import { enqueueReceiptProcessing } from "@/lib/queue";

export const dynamic = "force-dynamic";

async function getAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: "google"
    }
  });

  if (!account) return null;

  // Check if token is expired (with 5 minute buffer)
  const isExpired = account.expires_at && (account.expires_at * 1000) < (Date.now() + 5 * 60 * 1000);

  if (isExpired && account.refresh_token) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          refresh_token: account.refresh_token,
          grant_type: "refresh_token"
        })
      });

      if (response.ok) {
        const tokens = await response.json();

        await prisma.account.update({
          where: { id: account.id },
          data: {
            access_token: tokens.access_token,
            expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in
          }
        });

        return tokens.access_token;
      }
    } catch (error) {
      console.error("Token refresh error:", error);
    }
  }

  return account.access_token || null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const accessToken = await getAccessToken(userId);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Google account not connected" },
        { status: 403 }
      );
    }

    const { fileId, fileName, mimeType } = await request.json();

    if (!fileId || !fileName) {
      return NextResponse.json(
        { error: "File ID and name are required" },
        { status: 400 }
      );
    }

    // Download file from Google Drive
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const fileResponse = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!fileResponse.ok) {
      console.error("Failed to download file from Drive:", await fileResponse.text());
      return NextResponse.json(
        { error: "Failed to download file from Google Drive" },
        { status: 500 }
      );
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const fileSize = fileBuffer.length;

    // Determine content type
    let contentType = mimeType || "application/octet-stream";
    if (contentType.startsWith("image/")) {
      // Keep as is
    } else if (contentType === "application/pdf") {
      // Keep as is
    } else {
      const ext = fileName.toLowerCase().split(".").pop();
      if (ext === "pdf") {
        contentType = "application/pdf";
      } else if (["jpg", "jpeg"].includes(ext || "")) {
        contentType = "image/jpeg";
      } else if (ext === "png") {
        contentType = "image/png";
      }
    }

    const fileType = contentType.startsWith("image/") ? "image" : "pdf";

    // Generate presigned URL and upload to S3
    const { uploadUrl, cloud_storage_path } = await generatePresignedUploadUrl(
      fileName,
      contentType,
      false
    );

    // Upload to S3
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType
      },
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      console.error("Failed to upload to S3:", await uploadResponse.text());
      return NextResponse.json(
        { error: "Failed to upload file to storage" },
        { status: 500 }
      );
    }

    // Perform fraud detection
    const imageHash = await calculateImageHash(fileBuffer);
    const duplicateCheck = await checkForDuplicates(imageHash, userId);
    const metadataAnalysis = await analyzeMetadata(fileBuffer);
    const patternAnalysis = await detectSuspiciousPatterns(userId, null, null);
    const fraudRiskScore = calculateFraudRiskScore(
      duplicateCheck.isDuplicate,
      metadataAnalysis.manipulationScore,
      patternAnalysis.riskScore,
      undefined
    );

    // Create receipt record
    const receipt = await prisma.receipt.create({
      data: {
        userId,
        cloudStoragePath: cloud_storage_path,
        isPublic: false,
        originalFilename: fileName,
        fileType,
        fileSize,
        imageHash,
        isDuplicate: duplicateCheck.isDuplicate,
        duplicateOfId: duplicateCheck.duplicateOfId,
        manipulationScore: metadataAnalysis.manipulationScore,
        manipulationFlags: JSON.stringify(metadataAnalysis.flags),
        suspiciousPatterns: JSON.stringify(patternAnalysis.patterns),
        fraudRiskScore,
        verificationStatus: "pending",
        processingStatus: "queued",
      }
    });

    // Enqueue async OCR processing
    await enqueueReceiptProcessing(receipt.id, userId);

    return NextResponse.json({
      success: true,
      receiptId: receipt.id,
      message: "File imported successfully"
    });
  } catch (error) {
    console.error("Error importing Drive file:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
