-- CreateTable
CREATE TABLE "EmailTemplateOverride" (
    "id" TEXT NOT NULL,
    "emailType" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailTemplateOverride_emailType_locale_idx" ON "EmailTemplateOverride"("emailType", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplateOverride_emailType_key_locale_key" ON "EmailTemplateOverride"("emailType", "key", "locale");
