import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_LOCALES, LOCALE_COOKIE_NAME } from "@/lib/i18n-config";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const locale = body.locale;

  if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
    return NextResponse.json(
      { error: "Invalid locale" },
      { status: 400 }
    );
  }

  const response = NextResponse.json({ locale });

  response.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  return response;
}
