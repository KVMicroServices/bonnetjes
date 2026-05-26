-- CreateTable
CREATE TABLE "FailureReasonDefinition" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nl" TEXT,
    "de" TEXT,
    "fr" TEXT,
    "es" TEXT,
    "af" TEXT,
    "xh" TEXT,
    "zu" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureReasonDefinition_pkey" PRIMARY KEY ("code")
);
