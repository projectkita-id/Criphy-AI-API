import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import {
  ESSAY_MAX_SCORE,
  MCQ_MAX_SCORE,
  generateAssessmentBlueprint,
} from "./ai-content.service";

export class ProvisioningError extends Error {
  constructor(
    public code:
      | "CASE_NOT_FOUND"
      | "CASE_NOT_VALIDATED"
      | "QUESTIONS_LOCKED"
      | "AI_UNAVAILABLE",
    message: string
  ) {
    super(message);
  }
}

const moduleSummarySelect = {
  id: true,
  title: true,
  status: true,
  caseId: true,
  assessments: {
    select: { id: true, type: true, status: true },
  },
  _count: {
    select: { assessmentQuestions: true, studentAssignments: true },
  },
} as const;

export type ProvisionedModule = Prisma.LearningModuleGetPayload<{
  select: typeof moduleSummarySelect;
}>;

function isModuleReady(module: ProvisionedModule): boolean {
  const published = (type: "PRE_TEST" | "POST_TEST") =>
    module.assessments.some((assessment) => assessment.type === type && assessment.status === "PUBLISHED");

  return (
    module.status === "PUBLISHED" &&
    module._count.assessmentQuestions > 0 &&
    published("PRE_TEST") &&
    published("POST_TEST")
  );
}

/**
 * Ensures a validated case has a published learning module with
 * published pre/post-tests and AI-generated shared questions.
 *
 * - Existing ready modules are returned as-is unless `regenerate` is set.
 * - Regeneration is refused once any student attempt exists.
 */
export async function provisionModuleForCase(
  caseId: string,
  options: { regenerate?: boolean } = {}
): Promise<{ module: ProvisionedModule; created: boolean; regenerated: boolean }> {
  const caseStudy = await prisma.validatedCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      title: true,
      context: true,
      topic: true,
      stimulus: true,
      scientificData: true,
      targetConcept: true,
      possibleMisconceptions: true,
      expertAnswer: true,
      validationStatus: true,
    },
  });

  if (!caseStudy) {
    throw new ProvisioningError("CASE_NOT_FOUND", "Studi kasus tidak ditemukan");
  }

  if (caseStudy.validationStatus !== "VALIDATED") {
    throw new ProvisioningError(
      "CASE_NOT_VALIDATED",
      "Modul hanya bisa dibuat dari studi kasus yang sudah dipublikasikan"
    );
  }

  const existing = await prisma.learningModule.findFirst({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    select: moduleSummarySelect,
  });

  if (existing && isModuleReady(existing) && !options.regenerate) {
    return { module: existing, created: false, regenerated: false };
  }

  if (existing) {
    const attemptCount = await prisma.assessmentAttempt.count({
      where: { assessment: { moduleId: existing.id } },
    });

    if (attemptCount > 0) {
      if (isModuleReady(existing)) {
        throw new ProvisioningError(
          "QUESTIONS_LOCKED",
          "Soal tidak dapat dibuat ulang karena sudah ada siswa yang mengerjakan asesmen modul ini"
        );
      }
    }
  }

  let blueprint;

  try {
    blueprint = await generateAssessmentBlueprint({
      id: caseStudy.id,
      title: caseStudy.title,
      context: caseStudy.context,
      topic: caseStudy.topic,
      stimulus: caseStudy.stimulus,
      scientificData: caseStudy.scientificData,
      targetConcept: caseStudy.targetConcept,
      possibleMisconceptions: caseStudy.possibleMisconceptions,
      expertAnswer: caseStudy.expertAnswer,
    });
  } catch (error) {
    console.error("Failed to generate assessment blueprint:", error);
    throw new ProvisioningError(
      "AI_UNAVAILABLE",
      "AI gagal membuat soal asesmen. Pastikan OPENAI_API_KEY valid lalu coba lagi."
    );
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Serialize provisioning for the same case.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${caseId}))`;

      const current = await tx.learningModule.findFirst({
        where: { caseId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      const moduleData = {
        title: blueprint.module.title,
        description: blueprint.module.description,
        topic: caseStudy.topic,
        gradeLevel: "SMA",
        learningObjectives: blueprint.module.learningObjectives.map((item) => `- ${item}`).join("\n"),
        targetConcepts: blueprint.module.targetConcepts.map((item) => `- ${item}`).join("\n"),
        status: "PUBLISHED" as const,
      };

      let moduleId: string;
      let created = false;

      if (current) {
        moduleId = current.id;

        const attempts = await tx.assessmentAttempt.count({
          where: { assessment: { moduleId } },
        });

        if (attempts > 0) {
          throw new ProvisioningError(
            "QUESTIONS_LOCKED",
            "Soal tidak dapat dibuat ulang karena sudah ada siswa yang mengerjakan asesmen modul ini"
          );
        }

        await tx.assessmentQuestion.deleteMany({ where: { moduleId } });
        await tx.learningModule.update({ where: { id: moduleId }, data: moduleData });
      } else {
        const createdModule = await tx.learningModule.create({
          data: { ...moduleData, caseId },
          select: { id: true },
        });
        moduleId = createdModule.id;
        created = true;
      }

      for (const type of ["PRE_TEST", "POST_TEST"] as const) {
        await tx.assessment.upsert({
          where: { moduleId_type: { moduleId, type } },
          create: {
            moduleId,
            type,
            status: "PUBLISHED",
            title: `${type === "PRE_TEST" ? "Pre-Test" : "Post-Test"} — ${caseStudy.title}`,
          },
          update: { status: "PUBLISHED" },
        });
      }

      let order = 1;

      for (const question of blueprint.mcq) {
        await tx.assessmentQuestion.create({
          data: {
            moduleId,
            type: "MCQ",
            order: order++,
            questionText: question.questionText,
            options: question.options.map((option) => ({
              key: option.key.toUpperCase(),
              text: option.text,
            })),
            correctAnswer: question.correctAnswer.toUpperCase(),
            maxScore: MCQ_MAX_SCORE,
            indicator: question.indicator,
          },
        });
      }

      for (const question of blueprint.essay) {
        await tx.assessmentQuestion.create({
          data: {
            moduleId,
            type: "ESSAY",
            order: order++,
            questionText: question.questionText,
            rubric: question.rubric,
            maxScore: ESSAY_MAX_SCORE,
            indicator: question.indicator,
          },
        });
      }

      const module = await tx.learningModule.findUniqueOrThrow({
        where: { id: moduleId },
        select: moduleSummarySelect,
      });

      return { module, created };
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return { ...result, regenerated: Boolean(existing) };
}

/**
 * Finds a validated case in the given context that has no module yet
 * and provisions one. Used when a student requests a module and none
 * are ready, so the learning flow never silently falls back to local data.
 */
export async function provisionFirstAvailableModule(
  context: "DAILY_LIFE" | "ENVIRONMENT" | "TECHNOLOGY",
  studentId: string
): Promise<ProvisionedModule | null> {
  const candidates = await prisma.validatedCase.findMany({
    where: {
      context,
      validationStatus: "VALIDATED",
      OR: [
        { learningModules: { none: {} } },
        {
          learningModules: {
            some: {
              studentAssignments: { none: { studentId } },
              OR: [
                { status: { not: "PUBLISHED" } },
                { assessmentQuestions: { none: {} } },
              ],
            },
          },
        },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: 3,
  });

  for (const candidate of candidates) {
    try {
      const { module } = await provisionModuleForCase(candidate.id);
      return module;
    } catch (error) {
      console.error(`Failed to provision module for case ${candidate.id}:`, error);
    }
  }

  return null;
}
