export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const MINIMUM_QUERY_LENGTH = 2;
const MAXIMUM_RESULTS = 10;

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");

    if (!query || query.trim().length < MINIMUM_QUERY_LENGTH) {
      return NextResponse.json({ users: [] });
    }

    const trimmedQuery = query.trim();
    const currentUserId = (session.user as any).id as string;

    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            OR: [
              { name: { contains: trimmedQuery, mode: "insensitive" } },
              { email: { contains: trimmedQuery, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      take: MAXIMUM_RESULTS,
    });

    return NextResponse.json({ users });
  } catch (error) {
    logger.error({ error }, "Failed to search users");
    return NextResponse.json(
      { error: "Failed to search users" },
      { status: 500 }
    );
  }
}
