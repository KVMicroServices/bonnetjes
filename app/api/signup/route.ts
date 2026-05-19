export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/services/auth-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const result = await registerUser({ database: prisma }, body);

    if (!result.success) {
      const statusCode = result.validationError ? 400 : 400;
      return NextResponse.json(
        { error: result.error },
        { status: statusCode }
      );
    }

    return NextResponse.json(
      {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
