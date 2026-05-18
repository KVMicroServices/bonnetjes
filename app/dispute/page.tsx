import { getTranslations } from "next-intl/server";

interface DisputePageProps {
  searchParams: {
    reviewId?: string;
  };
}

export default async function DisputePage({ searchParams }: DisputePageProps) {
  const translations = await getTranslations("Dispute");
  const reviewId = searchParams.reviewId;

  let reviewIdSection: React.ReactNode = null;
  if (reviewId) {
    reviewIdSection = (
      <p className="mb-4 text-sm text-gray-500">
        {translations("reviewIdLabel")}: {reviewId}
      </p>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="mb-4 text-2xl font-bold text-gray-900">
          {translations("title")}
        </h1>
        <p className="mb-4 text-gray-600">
          {translations("underDevelopment")}
        </p>
        {reviewIdSection}
        <p className="text-sm text-gray-400">
          {translations("checkBackLater")}
        </p>
      </div>
    </main>
  );
}
