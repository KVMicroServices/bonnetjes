"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Upload,
  FileImage,
  FileText,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DisputeUploaderProps {
  token: string;
  reviewId: string;
}

interface VerifyResult {
  id: string;
  verificationStatus: string;
  failureReason: string | null;
  extractedShopName: string | null;
  extractedDate: string | null;
  extractedAmount: number | null;
  ocrConfidence: number | null;
  ocrReasoning: string | null;
  secondaryAnalysis: string | null;
}

type Phase =
  | "idle"
  | "uploading"
  | "verifying"
  | "verified"
  | "rejected"
  | "review_requested"
  | "error";

const ALLOWED_TYPES: ReadonlyArray<string> = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function determineFileType(mimeType: string): string {
  if (mimeType.includes("pdf")) {
    return "pdf";
  }
  return "image";
}

export function DisputeUploader({ token, reviewId }: DisputeUploaderProps) {
  const translations = useTranslations("Dispute");
  const failureTranslations = useTranslations("ReceiptCard");
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFileSelect = useCallback(
    (selected: File | null) => {
      if (!selected) {
        return;
      }

      if (!ALLOWED_TYPES.includes(selected.type)) {
        toast({
          title: translations("invalidType"),
          description: selected.name,
          variant: "destructive",
        });
        return;
      }

      if (selected.size > MAX_FILE_SIZE_BYTES) {
        toast({
          title: translations("fileTooLarge"),
          description: selected.name,
          variant: "destructive",
        });
        return;
      }

      setFile(selected);
      setResult(null);
      setErrorMessage(null);
      setPhase("idle");
    },
    [toast, translations]
  );

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragenter" || event.type === "dragover") {
      setDragActive(true);
      return;
    }
    if (event.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) {
        handleFileSelect(dropped);
      }
    },
    [handleFileSelect]
  );

  const submitFile = async () => {
    if (!file) {
      return;
    }

    setErrorMessage(null);
    setResult(null);
    setPhase("uploading");

    try {
      const presignResponse = await fetch("/api/dispute/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          fileName: file.name,
          contentType: file.type,
        }),
      });

      if (!presignResponse.ok) {
        const error = await presignResponse.json().catch(() => ({}));
        throw new Error(error?.error || translations("uploadUrlFailed"));
      }

      const { uploadUrl, cloud_storage_path } = await presignResponse.json();

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(translations("uploadFailed"));
      }

      setPhase("verifying");

      const verifyResponse = await fetch("/api/dispute/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          cloudStoragePath: cloud_storage_path,
          originalFilename: file.name,
          fileType: determineFileType(file.type),
          fileSize: file.size,
        }),
      });

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json().catch(() => ({}));
        throw new Error(error?.error || translations("verificationFailed"));
      }

      const verifyResult: VerifyResult = await verifyResponse.json();
      setResult(verifyResult);

      if (verifyResult.verificationStatus === "verified") {
        setPhase("verified");
        toast({
          title: translations("verifiedTitle"),
          description: translations("verifiedDescription"),
        });
        return;
      }

      setPhase("rejected");
    } catch (error) {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = translations("genericError");
      }
      setErrorMessage(message);
      setPhase("error");
    }
  };

  const requestHumanReview = async () => {
    if (!result?.id) {
      return;
    }

    try {
      const response = await fetch("/api/dispute/request-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, receiptId: result.id }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || translations("requestReviewFailed"));
      }

      setPhase("review_requested");
      toast({
        title: translations("reviewRequestedTitle"),
        description: translations("reviewRequestedDescription"),
      });
    } catch (error) {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = translations("genericError");
      }
      toast({
        title: translations("requestReviewFailed"),
        description: message,
        variant: "destructive",
      });
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setErrorMessage(null);
    setPhase("idle");
  };

  const isProcessing = phase === "uploading" || phase === "verifying";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-kv-green" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-gray-900">
            {translations("instructionsTitle")}
          </h2>
        </div>
        <ul className="mt-4 space-y-2 text-sm text-gray-700">
          <li>{translations("instructionPhoto")}</li>
          <li>{translations("instructionFlat")}</li>
          <li>{translations("instructionDate")}</li>
          <li>{translations("instructionFormat")}</li>
          <li>{translations("instructionMaxSize")}</li>
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {phase !== "verified" && phase !== "review_requested" && (
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragActive
                ? "border-kv-green bg-kv-green/5"
                : "border-gray-300 hover:border-gray-400"
            }`}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
              onChange={(event) => {
                const files = event.target.files;
                let selected: File | null = null;
                if (files && files[0]) {
                  selected = files[0];
                }
                handleFileSelect(selected);
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
              disabled={isProcessing}
              aria-label={translations("dropzoneLabel")}
            />
            <Upload className="mx-auto mb-3 h-10 w-10 text-gray-400" aria-hidden="true" />
            <p className="mb-1 text-gray-900">{translations("dropzonePrimary")}</p>
            <p className="text-sm text-gray-500">{translations("dropzoneSecondary")}</p>
          </div>
        )}

        {file && phase !== "verified" && phase !== "review_requested" && (
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-gray-50 p-3">
            {file.type.includes("pdf") ? (
              <FileText className="h-8 w-8 text-kv-green" aria-hidden="true" />
            ) : (
              <FileImage className="h-8 w-8 text-kv-green" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-900">{file.name}</p>
              <p className="text-sm text-gray-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            {!isProcessing && (
              <button
                type="button"
                onClick={reset}
                className="p-2 text-gray-400 hover:text-red-500"
                aria-label={translations("removeFile")}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {phase === "idle" && file && (
          <button
            type="button"
            onClick={submitFile}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-kv-green py-3 font-medium text-white transition-colors hover:bg-kv-green/90 disabled:bg-gray-300"
          >
            <Upload className="h-5 w-5" aria-hidden="true" />
            {translations("submitButton")}
          </button>
        )}

        {phase === "uploading" && (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-blue-50 py-3 text-blue-700">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>{translations("uploading")}</span>
          </div>
        )}

        {phase === "verifying" && (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-amber-50 py-3 text-amber-700">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>{translations("verifying")}</span>
          </div>
        )}

        {phase === "rejected" && result && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="h-5 w-5" aria-hidden="true" />
                {translations("rejectedTitle")}
              </div>
              <p className="mt-2 text-sm">{translations("rejectedDescription")}</p>
              {result.failureReason && (
                <p className="mt-2 text-sm">
                  <span className="font-medium">
                    {failureTranslations("failureReason")}:
                  </span>{" "}
                  {failureTranslations(`failure_${result.failureReason}`)}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={reset}
                className="flex-1 rounded-lg border border-gray-300 bg-white py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                {translations("retryButton")}
              </button>
              <button
                type="button"
                onClick={requestHumanReview}
                className="flex-1 rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700"
              >
                {translations("requestReviewButton")}
              </button>
            </div>
          </div>
        )}

        {phase === "verified" && result && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            <div className="flex items-center gap-2 font-medium">
              <Check className="h-5 w-5" aria-hidden="true" />
              {translations("verifiedTitle")}
            </div>
            <p className="mt-2 text-sm">{translations("verifiedDescription")}</p>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {result.extractedShopName && (
                <div>
                  <dt className="text-green-700/70">{translations("shopLabel")}</dt>
                  <dd className="font-medium">{result.extractedShopName}</dd>
                </div>
              )}
              {result.extractedDate && (
                <div>
                  <dt className="text-green-700/70">{translations("dateLabel")}</dt>
                  <dd className="font-medium">{result.extractedDate}</dd>
                </div>
              )}
              {result.extractedAmount !== null && (
                <div>
                  <dt className="text-green-700/70">{translations("amountLabel")}</dt>
                  <dd className="font-medium">{result.extractedAmount}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {phase === "review_requested" && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-800">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              {translations("reviewRequestedTitle")}
            </div>
            <p className="mt-2 text-sm">{translations("reviewRequestedDescription")}</p>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">{translations("errorTitle")}</p>
              <p className="mt-1 text-sm">{errorMessage}</p>
              <button
                type="button"
                onClick={reset}
                className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                {translations("retryButton")}
              </button>
            </div>
          </div>
        )}
        {!file && phase === "idle" && (
          <p className="sr-only">{`Review ${reviewId}`}</p>
        )}
      </section>
    </div>
  );
}
