export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { generateDisputePresignedUploadUrl, getFileAsBuffer } from "@/lib/s3";
import { presignDisputeUpload } from "@/lib/services/dispute-service";
import { resolveDisputeToken } from "@/lib/dispute/dispute-token-http";

const uploadRequestSchema = z.object({
  token: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = uploadRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { token, fileName, contentType } = parseResult.data;

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
