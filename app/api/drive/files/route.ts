import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/db";
import { listDriveFiles } from "@/lib/services/drive-service";

export const dynamic = "force-dynamic";

async function getAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      provider: "google"
    }
  });

  if (!account) return null;

  // Check if token is expired (with 5 minute buffer)
  const isExpired = account.expires_at && (account.expires_at * 1000) < (Date.now() + 5 * 60 * 1000);

  if (isExpired && account.refresh_token) {
    // Refresh the token
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          refresh_token: account.refresh_token,
          grant_type: "refresh_token"
        })
      });

      if (response.ok) {
        const tokens = await response.json();

        // Update the account with new tokens
        await prisma.account.update({
          where: { id: account.id },
          data: {
            access_token: tokens.access_token,
            expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in
          }
        });

        return tokens.access_token;
      }
    } catch (error) {
      console.error("Token refresh error:", error);
    }
  }

  return account.access_token || null;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const accessToken = await getAccessToken(userId);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Google account not connected. Please sign in with Google." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get("folderId") || "root";
    const sharedWithMe = searchParams.get("sharedWithMe") === "true";

    const result = await listDriveFiles(accessToken, folderId, sharedWithMe);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.statusCode }
      );
    }

    return NextResponse.json({
      folders: result.folders,
      files: result.files,
      currentFolder: result.currentFolder,
    });
  } catch (error) {
    console.error("Error fetching Drive files:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
