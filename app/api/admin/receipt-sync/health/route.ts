export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getHealthStatus } from "@/lib/services/receipt-sync-service";

export async function GET() {
  try {
    const result = await getHealthStatus({ database: prisma });

    if (!result.success) {
      return NextResponse.json(
        { status: "unhealthy", error: result.error },
        { status: 503 }
      );
    }

    const httpStatus = result.healthy ? 200 : 503;
    return NextResponse.json(result.data, { status: httpStatus });
  } catch (error: unknown) {
    logger.error({ error }, "Health check failed");
    return NextResponse.json(
      { status: "unhealthy", error: "Internal error" },
      { status: 503 }
    );
  }
}
