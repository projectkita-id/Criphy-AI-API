import { prisma } from "../lib/prisma";

// ==========================================
// Admin realtime monitoring snapshot
// ==========================================
// Everything the admin dashboard and monitoring page need, built from the
// real learning data. Filtering (context, search) happens on the client so a
// single snapshot can be pushed to every connected admin.

export type MonitoringStage = "PRE_TEST" | "LEARNING" | "POST_TEST" | "COMPLETED";

export type MonitoringAssignment = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  stage: MonitoringStage;
  context: string;
  student: { id: string; name: string; email: string };
  module: { id: string; title: string };
  caseTitle: string;
  currentPhase: number | null;
  completedPhases: number;
  /** 0-7: pre-test, 5 phases, post-test */
  completedSteps: number;
  preTest: number | null;
  postTest: number | null;
  /** Hake normalized gain, only when both tests are graded. */
  nGain: number | null;
  assignedAt: string;
  completedAt: string | null;
  lastActivityAt: string;
};

export type MonitoringEventType =
  | "MODULE_STARTED"
  | "PRE_TEST_SUBMITTED"
  | "PHASE_COMPLETED"
  | "POST_TEST_SUBMITTED"
  | "MODULE_COMPLETED"
  | "TUTOR_MESSAGE";

export type MonitoringEvent = {
  id: string;
  type: MonitoringEventType;
  at: string;
  studentId: string;
  studentName: string;
  context: string;
  moduleTitle: string;
  phaseNumber?: number;
  score?: number | null;
};

export type MonitoringSnapshot = {
  generatedAt: string;
  totals: {
    students: number;
    validatedCases: number;
    publishedModules: number;
  };
  assignments: MonitoringAssignment[];
  events: MonitoringEvent[];
};

const TOTAL_STEPS = 7;
const MAX_EVENTS = 40;

const round1 = (value: number) => Math.round(value * 10) / 10;

export function normalizedGain(pre: number | null, post: number | null): number | null {
  if (pre == null || post == null) return null;
  if (pre >= 100) return post >= 100 ? 1 : 0;
  return Math.round(((post - pre) / (100 - pre)) * 100) / 100;
}

const latest = (...dates: Array<Date | null | undefined>) =>
  dates.reduce<Date>(
    (max, date) => (date && date > max ? date : max),
    new Date(0)
  );

export async function buildMonitoringSnapshot(): Promise<MonitoringSnapshot> {
  const [studentCount, validatedCases, publishedModules, assignments] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.validatedCase.count({ where: { validationStatus: "VALIDATED" } }),
    prisma.learningModule.count({ where: { status: "PUBLISHED" } }),
    prisma.studentModuleAssignment.findMany({
      where: { student: { role: "STUDENT" } },
      orderBy: { assignedAt: "desc" },
      select: {
        id: true,
        studentId: true,
        moduleId: true,
        context: true,
        status: true,
        stage: true,
        assignedAt: true,
        completedAt: true,
        updatedAt: true,
        student: { select: { id: true, name: true, email: true } },
        module: {
          select: {
            id: true,
            title: true,
            case: { select: { title: true } },
            assessmentQuestions: { select: { id: true, maxScore: true } },
          },
        },
        learningSession: {
          select: {
            currentPhase: true,
            updatedAt: true,
            phases: {
              orderBy: { phaseNumber: "asc" },
              select: {
                id: true,
                phaseNumber: true,
                status: true,
                startedAt: true,
                completedAt: true,
                updatedAt: true,
                responses: {
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { id: true, createdAt: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  // Attempts for all assigned modules, matched to assignments by student+module.
  const attempts = assignments.length
    ? await prisma.assessmentAttempt.findMany({
        where: {
          studentId: { in: [...new Set(assignments.map((item) => item.studentId))] },
          assessment: {
            moduleId: { in: [...new Set(assignments.map((item) => item.moduleId))] },
          },
        },
        select: {
          id: true,
          studentId: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          gradedAt: true,
          assessment: { select: { moduleId: true, type: true } },
          answers: { select: { questionId: true, score: true } },
        },
      })
    : [];

  const attemptKey = (studentId: string, moduleId: string, type: string) =>
    `${studentId}:${moduleId}:${type}`;
  const attemptMap = new Map(
    attempts.map((attempt) => [
      attemptKey(attempt.studentId, attempt.assessment.moduleId, attempt.assessment.type),
      attempt,
    ])
  );

  const events: MonitoringEvent[] = [];

  const rows = assignments.map((assignment): MonitoringAssignment => {
    const questions = assignment.module.assessmentQuestions;
    const maxScore = questions.reduce((sum, question) => sum + question.maxScore, 0);

    // Percentage of a submitted attempt; null while not submitted or not fully graded.
    const scoreOf = (type: "PRE_TEST" | "POST_TEST") => {
      const attempt = attemptMap.get(attemptKey(assignment.studentId, assignment.moduleId, type));
      if (!attempt) return { attempt: null, percentage: null };

      const submitted = attempt.submittedAt !== null && attempt.status !== "IN_PROGRESS";
      if (!submitted || maxScore <= 0) return { attempt, percentage: null };

      const scores = new Map(attempt.answers.map((answer) => [answer.questionId, answer.score]));
      const graded = questions.every((question) => scores.get(question.id) != null);
      if (!graded) return { attempt, percentage: null };

      const total = questions.reduce((sum, question) => sum + (scores.get(question.id) ?? 0), 0);
      return { attempt, percentage: round1((total / maxScore) * 100) };
    };

    const pre = scoreOf("PRE_TEST");
    const post = scoreOf("POST_TEST");
    const phases = assignment.learningSession?.phases ?? [];
    const completedPhases = phases.filter((phase) => phase.status === "COMPLETED").length;

    const preSubmitted = Boolean(pre.attempt?.submittedAt);
    const postSubmitted = Boolean(post.attempt?.submittedAt);

    const lastActivity = latest(
      assignment.assignedAt,
      assignment.updatedAt,
      assignment.completedAt,
      pre.attempt?.startedAt,
      pre.attempt?.submittedAt,
      post.attempt?.startedAt,
      post.attempt?.submittedAt,
      assignment.learningSession?.updatedAt,
      ...phases.flatMap((phase) => [
        phase.startedAt,
        phase.completedAt,
        phase.updatedAt,
        phase.responses[0]?.createdAt,
      ])
    );

    const base = {
      studentId: assignment.student.id,
      studentName: assignment.student.name,
      context: assignment.context,
      moduleTitle: assignment.module.title,
    };

    events.push({
      ...base,
      id: `${assignment.id}:start`,
      type: "MODULE_STARTED",
      at: assignment.assignedAt.toISOString(),
    });

    if (pre.attempt?.submittedAt) {
      events.push({
        ...base,
        id: `${pre.attempt.id}:submit`,
        type: "PRE_TEST_SUBMITTED",
        at: pre.attempt.submittedAt.toISOString(),
        score: pre.percentage,
      });
    }

    for (const phase of phases) {
      if (phase.completedAt) {
        events.push({
          ...base,
          id: `${phase.id}:done`,
          type: "PHASE_COMPLETED",
          at: phase.completedAt.toISOString(),
          phaseNumber: phase.phaseNumber,
        });
      }

      const lastMessage = phase.responses[0];
      if (lastMessage && phase.status === "ACTIVE") {
        events.push({
          ...base,
          id: `${lastMessage.id}:msg`,
          type: "TUTOR_MESSAGE",
          at: lastMessage.createdAt.toISOString(),
          phaseNumber: phase.phaseNumber,
        });
      }
    }

    if (post.attempt?.submittedAt) {
      events.push({
        ...base,
        id: `${post.attempt.id}:submit`,
        type: "POST_TEST_SUBMITTED",
        at: post.attempt.submittedAt.toISOString(),
        score: post.percentage,
      });
    }

    if (assignment.status === "COMPLETED" && assignment.completedAt) {
      events.push({
        ...base,
        id: `${assignment.id}:completed`,
        type: "MODULE_COMPLETED",
        at: assignment.completedAt.toISOString(),
      });
    }

    const isCompleted = assignment.status === "COMPLETED" || assignment.stage === "COMPLETED";

    return {
      id: assignment.id,
      status: isCompleted ? "COMPLETED" : "IN_PROGRESS",
      stage: assignment.stage as MonitoringStage,
      context: assignment.context,
      student: assignment.student,
      module: { id: assignment.module.id, title: assignment.module.title },
      caseTitle: assignment.module.case?.title ?? assignment.module.title,
      currentPhase:
        assignment.stage === "LEARNING" ? assignment.learningSession?.currentPhase ?? 1 : null,
      completedPhases,
      completedSteps: Math.min(
        TOTAL_STEPS,
        (preSubmitted ? 1 : 0) + completedPhases + (postSubmitted ? 1 : 0)
      ),
      preTest: pre.percentage,
      postTest: post.percentage,
      nGain: normalizedGain(pre.percentage, post.percentage),
      assignedAt: assignment.assignedAt.toISOString(),
      completedAt: assignment.completedAt?.toISOString() ?? null,
      lastActivityAt: lastActivity.toISOString(),
    };
  });

  events.sort((a, b) => b.at.localeCompare(a.at));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      students: studentCount,
      validatedCases,
      publishedModules,
    },
    assignments: rows,
    events: events.slice(0, MAX_EVENTS),
  };
}

/**
 * Cheap change detector: a string that changes whenever any learning data
 * changes. The stream only rebuilds the full snapshot when this changes.
 */
export async function monitoringFingerprint(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ fp: string }>>`
    SELECT concat_ws('|',
      (SELECT count(*) FROM "User" WHERE role = 'STUDENT'),
      (SELECT count(*) FROM "ValidatedCase"),
      (SELECT max("updatedAt") FROM "ValidatedCase"),
      (SELECT count(*) FROM "LearningModule"),
      (SELECT max("updatedAt") FROM "LearningModule"),
      (SELECT count(*) FROM "StudentModuleAssignment"),
      (SELECT max("updatedAt") FROM "StudentModuleAssignment"),
      (SELECT count(*) FROM "AssessmentAttempt"),
      (SELECT max(greatest("startedAt", "submittedAt", "gradedAt")) FROM "AssessmentAttempt"),
      (SELECT count(*) FROM "AssessmentAnswer"),
      (SELECT max("gradedAt") FROM "AssessmentAnswer"),
      (SELECT max("updatedAt") FROM "LearningSession"),
      (SELECT max("updatedAt") FROM "LearningPhaseProgress"),
      (SELECT count(*) FROM "LearningPhaseResponse"),
      (SELECT max("updatedAt") FROM "LearningPhaseSubmission")
    ) AS fp
  `;

  return rows[0]?.fp ?? "";
}
