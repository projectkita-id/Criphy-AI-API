/*
  Warnings:

  - A unique constraint covering the columns `[caseGroupId,version]` on the table `ValidatedCase` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ValidatedCase" ADD COLUMN     "caseGroupId" UUID;

-- CreateIndex
CREATE INDEX "ValidatedCase_caseGroupId_idx" ON "ValidatedCase"("caseGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidatedCase_caseGroupId_version_key" ON "ValidatedCase"("caseGroupId", "version");
