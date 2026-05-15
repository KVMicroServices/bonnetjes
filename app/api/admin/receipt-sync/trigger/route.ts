export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { logger } from "@/lib/logger";
import { executeTick } from "@/lib/receipt-sync";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as { role?: string }).role;
    if (userRole !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    logger.info("Manual sync tick triggered by admin");

    const tickResults = await executeTick();

    return NextResponse.json({
      success: true,
      message: "Sync tick completed",
      tickResults,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error: message }, "Manual sync trigger failed");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
