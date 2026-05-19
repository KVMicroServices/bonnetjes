export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { executeWorkflow } from "@/lib/services/automation-service";

const PLATFORM_CREDENTIALS = {
  kvUser: process.env.KV_USER || "",
  kvPass: process.env.KV_PASS || "",
  kiyohUser: process.env.KIYOH_USER || "",
  kiyohPass: process.env.KIYOH_PASS || "",
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workflowId, variables = {}, dryRun = false } = await request.json();

  const result = await executeWorkflow(
    { database: prisma, credentials: PLATFORM_CREDENTIALS },
    workflowId,
    variables,
    dryRun
  );

  if (!result.success) {
    const statusCode = result.statusCode || (result.notFound ? 404 : 500);
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  return NextResponse.json(result.response);
}
