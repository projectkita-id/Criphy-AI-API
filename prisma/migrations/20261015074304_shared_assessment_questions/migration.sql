/*
  Warnings:

  - You are about to drop the column `assessmentId` on the `AssessmentQuestion` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[moduleId,order]` on the table `AssessmentQuestion` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `moduleId` to the `AssessmentQuestion` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AssessmentQuestion" DROP CONSTRAINT "AssessmentQuestion_assessmentId_fkey";

-- DropIndex
DROP INDEX "AssessmentQuestion_assessmentId_idx";

-- DropIndex
DROP INDEX "AssessmentQuestion_assessmentId_order_key";

-- AlterTable
ALTER TABLE "AssessmentQuestion" DROP COLUMN "assessmentId",
ADD COLUMN     "indicator" TEXT,
ADD COLUMN     "moduleId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "AssessmentQuestion_moduleId_idx" ON "AssessmentQuestion"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentQuestion_moduleId_order_key" ON "AssessmentQuestion"("moduleId", "order");

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "LearningModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
