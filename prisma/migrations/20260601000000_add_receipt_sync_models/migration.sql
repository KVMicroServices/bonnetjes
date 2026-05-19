-- CreateTable
CREATE TABLE "ReceiptSyncState" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "s3Key" TEXT,
    "s3Etag" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorMessage" TEXT,
    "receiptContent" TEXT,
    "receiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSyncWatermark" (
    "id" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "watermark" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptSyncWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSyncTick" (
    "id" TEXT NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "locationsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "reviewsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "receiptsProcessed" INTEGER NOT NULL DEFAULT 0,
    "noReceiptCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptSyncTick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSyncState_reviewId_key" ON "ReceiptSyncState"("reviewId");

-- CreateIndex
CREATE INDEX "ReceiptSyncState_tenantId_idx" ON "ReceiptSyncState"("tenantId");

-- CreateIndex
CREATE INDEX "ReceiptSyncState_status_idx" ON "ReceiptSyncState"("status");

-- CreateIndex
CREATE INDEX "ReceiptSyncState_reviewId_status_idx" ON "ReceiptSyncState"("reviewId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSyncWatermark_tenantId_key" ON "ReceiptSyncWatermark"("tenantId");

-- CreateIndex
CREATE INDEX "ReceiptSyncTick_tenantId_completedAt_idx" ON "ReceiptSyncTick"("tenantId", "completedAt");
