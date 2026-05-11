import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({ status: "healthy" }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { status: "unhealthy", error: "database unreachable" },
      { status: 503 }
    );
  }
}
