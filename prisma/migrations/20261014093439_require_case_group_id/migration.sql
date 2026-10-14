/*
  Warnings:

  - Made the column `caseGroupId` on table `ValidatedCase` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ValidatedCase" ALTER COLUMN "caseGroupId" SET NOT NULL;
