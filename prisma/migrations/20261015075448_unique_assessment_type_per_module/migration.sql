/*
  Warnings:

  - A unique constraint covering the columns `[moduleId,type]` on the table `Assessment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Assessment_moduleId_type_key" ON "Assessment"("moduleId", "type");
