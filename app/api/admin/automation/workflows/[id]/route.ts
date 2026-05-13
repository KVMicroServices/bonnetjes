import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { getWorkflow } from "@/lib/services/automation-service";

const PLATFORM_CREDENTIALS = {
  kvUser: process.env.KV_USER || "",
  kvPass: process.env.KV_PASS || "",
  kiyohUser: process.env.KIYOH_USER || "",
  kiyohPass: process.env.KIYOH_PASS || "",
};

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getWorkflow(
    { database: prisma, credentials: PLATFORM_CREDENTIALS },
    params.id
  );

  if (!result.success) {
    const statusCode = result.notFound ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status: statusCode });
  }

  return NextResponse.json({ workflow: { ...result.workflow, steps: result.workflow.steps } });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updateData.name = body.name;
  }
  if (body.description !== undefined) {
    updateData.description = body.description;
  }
  if (body.platform !== undefined) {
    updateData.platform = body.platform;
  }
  if (body.steps !== undefined) {
    updateData.steps = JSON.stringify(body.steps);
  }
  if (body.isActive !== undefined) {
    updateData.isActive = body.isActive;
  }

  const workflow = await prisma.automationWorkflow.update({
    where: { id: params.id },
    data: updateData,
  });

  return NextResponse.json({ workflow });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.automationWorkflow.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
