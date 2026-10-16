-- CreateEnum
CREATE TYPE "ModuleAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ModuleProgressStage" AS ENUM ('PRE_TEST', 'LEARNING', 'POST_TEST', 'COMPLETED');

-- CreateTable
CREATE TABLE "StudentModuleAssignment" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "moduleId" UUID NOT NULL,
    "context" "LearningContext" NOT NULL,
    "status" "ModuleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "stage" "ModuleProgressStage" NOT NULL DEFAULT 'PRE_TEST',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentModuleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentModuleAssignment_studentId_status_idx" ON "StudentModuleAssignment"("studentId", "status");

-- CreateIndex
CREATE INDEX "StudentModuleAssignment_moduleId_idx" ON "StudentModuleAssignment"("moduleId");

-- CreateIndex
CREATE INDEX "StudentModuleAssignment_context_idx" ON "StudentModuleAssignment"("context");

-- CreateIndex
CREATE UNIQUE INDEX "StudentModuleAssignment_studentId_moduleId_key" ON "StudentModuleAssignment"("studentId", "moduleId");

-- AddForeignKey
ALTER TABLE "StudentModuleAssignment" ADD CONSTRAINT "StudentModuleAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentModuleAssignment" ADD CONSTRAINT "StudentModuleAssignment_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "LearningModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "StudentModuleAssignment_one_active_per_student"
ON "StudentModuleAssignment" ("studentId")
WHERE "status" = 'ACTIVE';