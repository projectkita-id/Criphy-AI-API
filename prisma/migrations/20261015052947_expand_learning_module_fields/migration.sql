-- AlterTable
ALTER TABLE "LearningModule" ADD COLUMN     "gradeLevel" TEXT NOT NULL DEFAULT 'SMA',
ADD COLUMN     "learningObjectives" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "targetConcepts" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
