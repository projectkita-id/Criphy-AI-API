import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import {
  AIEvaluationService,
  extractPhaseItems,
  type CaseStudyEvaluationContext,
  type PhaseAnswerGroup,
  type PhaseEvaluationResult,
} from "./ai-evaluation.service";

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface EvaluablePhase {
  phaseNumber: number;
  status: string;
  submission: { id: string; content: unknown } | null;
  responses: Array<{ question: string | null; answer: string }>;
}

/**
 * Converts stored learning phases into question/answer groups.
 */
export function buildPhaseGroups(phases: EvaluablePhase[]): PhaseAnswerGroup[] {
  return phases
    .filter((phase) => phase.status !== "LOCKED")
    .map((phase) => {
      const { items, confidence } = extractPhaseItems(
        phase.phaseNumber,
        phase.submission?.content,
        phase.responses
      );

      return { phaseNumber: phase.phaseNumber, items, confidence };
    });
}

export function readStoredPhaseEvaluation(content: unknown): PhaseEvaluationResult | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return null;
  }

  const evaluation = (content as Record<string, unknown>).aiEvaluation;

  if (
    evaluation &&
    typeof evaluation === "object" &&
    Array.isArray((evaluation as Record<string, unknown>).phaseScores)
  ) {
    return evaluation as PhaseEvaluationResult;
  }

  return null;
}

/**
 * Returns the stored Phase 1-5 evaluation, or evaluates the phases
 * and stores the result on the Phase 5 submission.
 * Heuristic (non-AI) evaluations are re-attempted on the next call.
 */
export async function getOrCreatePhaseEvaluation(
  db: DbClient,
  phases: EvaluablePhase[],
  caseStudy: CaseStudyEvaluationContext,
  options: { force?: boolean } = {}
): Promise<PhaseEvaluationResult | null> {
  const phaseFive = phases.find((phase) => phase.phaseNumber === 5);

  if (!phaseFive || phaseFive.status !== "COMPLETED") {
    return null;
  }

  const stored = readStoredPhaseEvaluation(phaseFive.submission?.content);

  if (stored && stored.evaluatedBy === "AI" && !options.force) {
    return stored;
  }

  const evaluation = await AIEvaluationService.evaluateLearningPhases({
    caseStudy,
    phases: buildPhaseGroups(phases),
  });

  if (phaseFive.submission) {
    const content =
      phaseFive.submission.content && typeof phaseFive.submission.content === "object"
        ? (phaseFive.submission.content as Record<string, unknown>)
        : {};

    await db.learningPhaseSubmission.update({
      where: { id: phaseFive.submission.id },
      data: {
        content: {
          ...content,
          aiEvaluation: evaluation as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonObject,
      },
    });
  }

  return evaluation;
}
