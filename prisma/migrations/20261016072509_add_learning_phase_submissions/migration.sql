-- CreateTable
CREATE TABLE "LearningPhaseSubmission" (
    "id" UUID NOT NULL,
    "phaseProgressId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPhaseSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningPhaseSubmission_phaseProgressId_key" ON "LearningPhaseSubmission"("phaseProgressId");

-- AddForeignKey
ALTER TABLE "LearningPhaseSubmission" ADD CONSTRAINT "LearningPhaseSubmission_phaseProgressId_fkey" FOREIGN KEY ("phaseProgressId") REFERENCES "LearningPhaseProgress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
