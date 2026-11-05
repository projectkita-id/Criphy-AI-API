import { prisma } from "../lib/prisma";
import {
  AIEvaluationService,
  PHASE_TITLES,
  extractPhaseItems,
} from "./ai-evaluation.service";
import { readStoredPhaseEvaluation } from "./learning-evaluation.helper";

const round2 = (value: number) => Math.round(value * 100) / 100;

const STEP_LABELS = [
  "Pre-Test",
  "Fase 1",
  "Fase 2",
  "Fase 3",
  "Fase 4",
  "Fase 5",
  "Post-Test",
];

/**
 * Builds the learning history for a student: every module
 * assignment (in progress or completed) with assessment scores,
 * phase answers, and stored evaluations. Never calls AI.
 */
export async function buildLearningHistory(studentId: string) {
  const assignments = await prisma.studentModuleAssignment.findMany({
    where: { studentId },
    orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      moduleId: true,
      context: true,
      status: true,
      stage: true,
      assignedAt: true,
      completedAt: true,
      updatedAt: true,
      module: {
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
              stimulus: true,
            },
          },
        },
      },
      learningSession: {
        select: {
          id: true,
          status: true,
          currentPhase: true,
          startedAt: true,
          completedAt: true,
          phases: {
            orderBy: { phaseNumber: "asc" },
            select: {
              id: true,
              phaseNumber: true,
              status: true,
              startedAt: true,
              completedAt: true,
              responses: {
                orderBy: { createdAt: "asc" },
                select: {
                  question: true,
                  answer: true,
                  aiFeedback: true,
                  createdAt: true,
                },
              },
              submission: {
                select: {
                  id: true,
                  content: true,
                  submittedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const moduleIds = [...new Set(assignments.map((assignment) => assignment.moduleId))];

  const attempts =
    moduleIds.length > 0
      ? await prisma.assessmentAttempt.findMany({
          where: {
            studentId,
            assessment: { moduleId: { in: moduleIds } },
          },
          select: {
            id: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            gradedAt: true,
            assessment: {
              select: {
                id: true,
                title: true,
                type: true,
                moduleId: true,
              },
            },
            answers: {
              select: {
                questionId: true,
                answer: true,
                score: true,
                feedback: true,
              },
            },
          },
        })
      : [];

  const questions =
    moduleIds.length > 0
      ? await prisma.assessmentQuestion.findMany({
          where: { moduleId: { in: moduleIds } },
          orderBy: { order: "asc" },
          select: {
            id: true,
            moduleId: true,
            type: true,
            order: true,
            questionText: true,
            options: true,
            correctAnswer: true,
            maxScore: true,
            indicator: true,
          },
        })
      : [];

  const buildAttempt = (attempt: (typeof attempts)[number] | undefined) => {
    if (!attempt) return null;

    const submitted = attempt.submittedAt !== null && attempt.status !== "IN_PROGRESS";
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    const moduleQuestions = questions.filter(
      (question) => question.moduleId === attempt.assessment.moduleId
    );

    const totalScore = moduleQuestions.reduce(
      (sum, question) => sum + (answerMap.get(question.id)?.score ?? 0),
      0
    );
    const maxScore = moduleQuestions.reduce((sum, question) => sum + question.maxScore, 0);
    const isGraded =
      submitted && moduleQuestions.every((question) => answerMap.get(question.id)?.score != null);

    return {
      attemptId: attempt.id,
      title: attempt.assessment.title,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      gradedAt: attempt.gradedAt,
      isSubmitted: submitted,
      isGraded,
      totalScore: submitted ? round2(totalScore) : null,
      maxScore,
      percentage: submitted && maxScore > 0 ? round2((totalScore / maxScore) * 100) : null,
      questions: moduleQuestions.map((question) => {
        const answer = answerMap.get(question.id);

        return {
          id: question.id,
          order: question.order,
          type: question.type,
          questionText: question.questionText,
          options: question.options,
          indicator: question.indicator,
          maxScore: question.maxScore,
          // Only reveal the key after submission
          correctAnswer: submitted && question.type === "MCQ" ? question.correctAnswer : null,
          answer: answer?.answer ?? null,
          score: submitted ? answer?.score ?? null : null,
          feedback: submitted ? answer?.feedback ?? null : null,
          isCorrect:
            submitted && question.type === "MCQ" && answer
              ? answer.answer === question.correctAnswer
              : null,
        };
      }),
    };
  };

  return assignments.map((assignment) => {
    const moduleAttempts = attempts.filter(
      (attempt) => attempt.assessment.moduleId === assignment.moduleId
    );
    const preTest = buildAttempt(moduleAttempts.find((a) => a.assessment.type === "PRE_TEST"));
    const postTest = buildAttempt(moduleAttempts.find((a) => a.assessment.type === "POST_TEST"));

    const session = assignment.learningSession;
    const phases = [1, 2, 3, 4, 5].map((phaseNumber) => {
      const phase = session?.phases.find((item) => item.phaseNumber === phaseNumber);
      const { items, confidence } = phase
        ? extractPhaseItems(phaseNumber, phase.submission?.content, phase.responses)
        : { items: [], confidence: null };

      return {
        phaseNumber,
        title: PHASE_TITLES[phaseNumber],
        status: phase?.status ?? "LOCKED",
        startedAt: phase?.startedAt ?? null,
        completedAt: phase?.completedAt ?? null,
        submittedAt: phase?.submission?.submittedAt ?? null,
        confidence,
        items,
        tutorMessages:
          phase?.responses
            .filter((response) => response.aiFeedback)
            .map((response) => ({
              answer: response.answer,
              aiFeedback: response.aiFeedback,
              createdAt: response.createdAt,
            })) ?? [],
      };
    });

    const phaseFive = session?.phases.find((phase) => phase.phaseNumber === 5);
    const phaseEvaluation = readStoredPhaseEvaluation(phaseFive?.submission?.content);

    const progression =
      preTest?.percentage != null && postTest?.percentage != null && phaseEvaluation
        ? AIEvaluationService.calculateProgression({
            prePercentage: preTest.percentage,
            postPercentage: postTest.percentage,
            phaseScore: phaseEvaluation.phaseScore,
          })
        : null;

    const completedPhases = phases.filter((phase) => phase.status === "COMPLETED").length;
    const completedSteps =
      (preTest?.isSubmitted ? 1 : 0) + completedPhases + (postTest?.isSubmitted ? 1 : 0);

    const isCompleted = assignment.status === "COMPLETED" || assignment.stage === "COMPLETED";

    const currentStepLabel = isCompleted
      ? "Selesai"
      : assignment.stage === "PRE_TEST"
        ? "Pre-Test"
        : assignment.stage === "POST_TEST"
          ? "Post-Test"
          : `Fase ${session?.currentPhase ?? 1}`;

    return {
      id: assignment.id,
      context: assignment.context,
      status: isCompleted ? ("COMPLETED" as const) : ("IN_PROGRESS" as const),
      stage: assignment.stage,
      startedAt: assignment.assignedAt,
      completedAt: assignment.completedAt,
      lastActivityAt: assignment.updatedAt,
      module: {
        id: assignment.module.id,
        title: assignment.module.title,
        topic: assignment.module.topic,
        description: assignment.module.description,
      },
      caseStudy: {
        id: assignment.module.case.id,
        title: assignment.module.case.title,
        context: assignment.module.case.context,
        topic: assignment.module.case.topic,
        description: assignment.module.case.stimulus,
      },
      progress: {
        completedSteps,
        totalSteps: STEP_LABELS.length,
        percentage: Math.round((completedSteps / STEP_LABELS.length) * 100),
        currentStepLabel,
      },
      learningSession: session
        ? {
            id: session.id,
            status: session.status,
            currentPhase: session.currentPhase,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
          }
        : null,
      preTest,
      postTest,
      phases,
      phaseEvaluation,
      progression,
    };
  });
}

export type LearningHistoryItem = Awaited<ReturnType<typeof buildLearningHistory>>[number];
