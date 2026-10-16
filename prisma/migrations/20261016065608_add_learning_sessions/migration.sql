-- CreateEnum
CREATE TYPE "LearningSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LearningPhaseStatus" AS ENUM ('LOCKED', 'ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "status" "LearningSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "currentPhase" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPhaseProgress" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "phaseNumber" INTEGER NOT NULL,
    "status" "LearningPhaseStatus" NOT NULL DEFAULT 'LOCKED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPhaseProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPhaseResponse" (
    "id" UUID NOT NULL,
    "phaseProgressId" UUID NOT NULL,
    "answer" TEXT NOT NULL,
    "question" TEXT,
    "aiFeedback" TEXT,
    "aiMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningPhaseResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningSession_assignmentId_key" ON "LearningSession"("assignmentId");

-- CreateIndex
CREATE INDEX "LearningSession_status_idx" ON "LearningSession"("status");

-- CreateIndex
CREATE INDEX "LearningPhaseProgress_status_idx" ON "LearningPhaseProgress"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPhaseProgress_sessionId_phaseNumber_key" ON "LearningPhaseProgress"("sessionId", "phaseNumber");

-- CreateIndex
CREATE INDEX "LearningPhaseResponse_phaseProgressId_createdAt_idx" ON "LearningPhaseResponse"("phaseProgressId", "createdAt");

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "StudentModuleAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPhaseProgress" ADD CONSTRAINT "LearningPhaseProgress_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPhaseResponse" ADD CONSTRAINT "LearningPhaseResponse_phaseProgressId_fkey" FOREIGN KEY ("phaseProgressId") REFERENCES "LearningPhaseProgress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrict learning sessions to phases 1-5
ALTER TABLE "LearningSession"
ADD CONSTRAINT "LearningSession_currentPhase_range"
CHECK ("currentPhase" BETWEEN 1 AND 5);

-- Restrict phase progress records to phases 1-5
ALTER TABLE "LearningPhaseProgress"
ADD CONSTRAINT "LearningPhaseProgress_phaseNumber_range"
CHECK ("phaseNumber" BETWEEN 1 AND 5);