/*
  Warnings:

  - A unique constraint covering the columns `[assessmentId,studentId]` on the table `AssessmentAttempt` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_assessmentId_studentId_key" ON "AssessmentAttempt"("assessmentId", "studentId");
