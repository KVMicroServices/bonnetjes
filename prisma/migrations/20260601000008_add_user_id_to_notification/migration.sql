-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
