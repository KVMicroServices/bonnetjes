import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_LOCALES, LOCALE_COOKIE_NAME, SupportedLocale } from "@/lib/i18n-config";

export async function POST(request: NextRequest) {
  let body: { locale?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const locale = body.locale;

  if (!locale || !SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
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
