-- CreateTable
CREATE TABLE "ReceiptDispute" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "tenantId" INTEGER,
    "locationId" TEXT,
    "receiptId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptDispute_reviewId_idx" ON "ReceiptDispute"("reviewId");

-- CreateIndex
CREATE INDEX "ReceiptDispute_receiptId_idx" ON "ReceiptDispute"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptDispute_status_idx" ON "ReceiptDispute"("status");
