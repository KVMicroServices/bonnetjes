export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { getAuditLogsForReceipt } from "@/lib/services/audit-log-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const auditEntries = await getAuditLogsForReceipt(id);

    return NextResponse.json({ entries: auditEntries });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ errorMessage, error }, "Failed to fetch receipt activity");
    return NextResponse.json(
      { error: "Failed to fetch receipt activity" },
      { status: 500 }
    );
  }
}
