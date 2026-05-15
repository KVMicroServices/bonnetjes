-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'queued';
