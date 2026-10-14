-- CreateEnum
CREATE TYPE "LearningContext" AS ENUM ('DAILY_LIFE', 'ENVIRONMENT', 'TECHNOLOGY');

-- CreateEnum
CREATE TYPE "CaseValidationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'VALIDATED', 'REJECTED');

-- CreateTable
CREATE TABLE "ValidatedCase" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "context" "LearningContext" NOT NULL,
    "topic" TEXT NOT NULL,
    "stimulus" TEXT NOT NULL,
    "scientificData" JSONB,
    "targetConcept" TEXT NOT NULL,
    "possibleMisconceptions" JSONB,
    "expertAnswer" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "validationStatus" "CaseValidationStatus" NOT NULL DEFAULT 'DRAFT',
    "validatorId" UUID,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidatedCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValidatedCase_context_idx" ON "ValidatedCase"("context");

-- CreateIndex
CREATE INDEX "ValidatedCase_validationStatus_idx" ON "ValidatedCase"("validationStatus");

-- CreateIndex
CREATE INDEX "ValidatedCase_validatorId_idx" ON "ValidatedCase"("validatorId");

-- AddForeignKey
ALTER TABLE "ValidatedCase" ADD CONSTRAINT "ValidatedCase_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
