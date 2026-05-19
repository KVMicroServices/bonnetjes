-- CreateTable
CREATE TABLE "ReviewDisableAudit" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewDisableAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewDisableAudit_receiptId_idx" ON "ReviewDisableAudit"("receiptId");

-- CreateIndex
CREATE INDEX "ReviewDisableAudit_reviewId_idx" ON "ReviewDisableAudit"("reviewId");

-- CreateIndex
CREATE INDEX "ReviewDisableAudit_status_idx" ON "ReviewDisableAudit"("status");
