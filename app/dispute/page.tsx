import { getTranslations } from "next-intl/server";
import { DisputeUploader } from "@/components/dispute-uploader";
import { verifyDisputeToken } from "@/lib/dispute/dispute-token";

interface DisputePageProps {
  searchParams: {
    token?: string;
  };
}

export default async function DisputePage({ searchParams }: DisputePageProps) {
  const translations = await getTranslations("Dispute");
  const rawToken = searchParams.token;

  let token: string | null = null;
  if (rawToken && rawToken.trim().length > 0) {
    token = rawToken.trim();
  }

  const verification = verifyDisputeToken(token);

  if (!verification.success) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-4 text-2xl font-bold text-gray-900">
            {translations("title")}
          </h1>
          <p className="mb-2 text-amber-700">
            {invalidLinkTitle(verification.error, translations)}
          </p>
          <p className="text-sm text-gray-600">
            {translations("invalidLinkBody")}
          </p>
        </div>
      </main>
    );
  }

  const verifiedToken: string = token!;
  const { payload } = verification;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">
            {translations("title")}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            {translations("intro")}
          </p>
          <p className="mt-3 text-xs text-gray-500">
            {translations("reviewIdLabel")}: <span className="font-mono">{payload.reviewId}</span>
          </p>
        </header>

        <DisputeUploader token={verifiedToken} reviewId={payload.reviewId} />
      </div>
    </main>
  );
}

function invalidLinkTitle(
  error: "missing_token" | "malformed_token" | "invalid_signature" | "expired_token" | "missing_secret",
  translations: (key: string) => string
): string {
  if (error === "expired_token") {
    return translations("invalidLinkExpired");
  }
  if (error === "missing_token") {
    return translations("invalidLinkMissing");
  }
  return translations("invalidLinkInvalid");
}
