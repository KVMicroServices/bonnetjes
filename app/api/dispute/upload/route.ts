export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { generateDisputePresignedUploadUrl, getFileAsBuffer } from "@/lib/s3";
import { presignDisputeUpload } from "@/lib/services/dispute-service";
import { resolveDisputeToken } from "@/lib/dispute/dispute-token-http";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, fileName, contentType } = body;

    const tokenResult = resolveDisputeToken(token);
    if (!tokenResult.success) {
      return tokenResult.response;
    }

    const result = await presignDisputeUpload(
      {
        storage: {
          generateDisputePresignedUploadUrl,
          getFileAsBuffer,
        },
      },
      {
        payload: tokenResult.payload,
        fileName,
        contentType,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode });
    }

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      cloud_storage_path: result.cloudStoragePath,
    });
  } catch (error) {
    logger.error({ error }, "Dispute presign error");
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
