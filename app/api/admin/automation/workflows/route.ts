import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { listWorkflows, createWorkflow } from "@/lib/services/automation-service";

const PLATFORM_CREDENTIALS = {
  kvUser: process.env.KV_USER || "",
  kvPass: process.env.KV_PASS || "",
  kiyohUser: process.env.KIYOH_USER || "",
  kiyohPass: process.env.KIYOH_PASS || "",
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await listWorkflows({
    database: prisma,
    credentials: PLATFORM_CREDENTIALS,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ workflows: result.workflows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const result = await createWorkflow(
    { database: prisma, credentials: PLATFORM_CREDENTIALS },
    {
      name: body.name,
      platform: body.platform,
      description: body.description,
      steps: body.steps,
    }
  );

  if (!result.success) {
    const statusCode = result.validationError ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  return NextResponse.json({ workflow: result.workflow });
}
