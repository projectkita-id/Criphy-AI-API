-- CreateEnum
CREATE TYPE "ModuleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "LearningModule" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "topic" TEXT NOT NULL,
    "status" "ModuleStatus" NOT NULL DEFAULT 'DRAFT',
    "caseId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningModule_caseId_idx" ON "LearningModule"("caseId");

-- CreateIndex
CREATE INDEX "LearningModule_status_idx" ON "LearningModule"("status");

-- AddForeignKey
ALTER TABLE "LearningModule" ADD CONSTRAINT "LearningModule_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ValidatedCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
