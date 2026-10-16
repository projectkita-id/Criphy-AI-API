import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

const paramsSchema = z.object({
  attemptId: z.uuid(),
});

const gradeParamsSchema = z.object({
  answerId: z.uuid(),
});

const gradeBodySchema = z.object({
  score: z.number().finite().min(0),
  feedback: z.string().trim().min(1).max(5000),
}).strict();

// ==========================================
// GET /api/admin/assessment-attempts/:attemptId
// Review submitted assessment answers
// ==========================================

router.get(
  "/assessment-attempts/:attemptId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedParams = paramsSchema.safeParse(
      req.params
    );

    if (!parsedParams.success) {
      res.status(400).json({
        success: false,
        message: "Invalid attempt ID",
      });
      return;
    }

    const { attemptId } = parsedParams.data;

    try {
      const attempt =
        await prisma.assessmentAttempt.findUnique({
          where: {
            id: attemptId,
          },
          select: {
            id: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            gradedAt: true,

            student: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },

            assessment: {
              select: {
                id: true,
                title: true,
                type: true,
                module: {
                  select: {
                    id: true,
                    title: true,
                    topic: true,
                    assessmentQuestions: {
                      orderBy: {
                        order: "asc",
                      },
                      select: {
                        id: true,
                        type: true,
                        questionText: true,
                        order: true,
                        options: true,
                        correctAnswer: true,
                        rubric: true,
                        maxScore: true,
                        indicator: true,
                      },
                    },
                  },
                },
              },
            },

            answers: {
              select: {
                id: true,
                questionId: true,
                answer: true,
                score: true,
                feedback: true,
                gradedAt: true,
              },
            },
          },
        });

      if (!attempt) {
        res.status(404).json({
          success: false,
          message: "Assessment attempt not found",
        });
        return;
      }

      // Do not allow review of unfinished attempts.
      if (attempt.status === "IN_PROGRESS") {
        res.status(409).json({
          success: false,
          message:
            "Assessment has not been submitted yet",
        });
        return;
      }

      // ==========================================
      // Combine questions with student answers
      // ==========================================

      const answerMap = new Map(
        attempt.answers.map((answer) => [
          answer.questionId,
          answer,
        ])
      );

      const questions =
        attempt.assessment.module.assessmentQuestions.map(
          (question) => {
            const studentAnswer =
              answerMap.get(question.id);

            return {
              id: question.id,
              type: question.type,
              order: question.order,
              questionText: question.questionText,
              options: question.options,
              correctAnswer: question.correctAnswer,
              rubric: question.rubric,
              maxScore: question.maxScore,
              indicator: question.indicator,

              studentAnswer: studentAnswer
                ? {
                    id: studentAnswer.id,
                    answer: studentAnswer.answer,
                    score: studentAnswer.score,
                    feedback: studentAnswer.feedback,
                    gradedAt: studentAnswer.gradedAt,
                  }
                : null,
            };
          }
        );

      // ==========================================
      // Calculate grading progress
      // ==========================================

      const totalQuestions = questions.length;

      const gradedQuestions = questions.filter(
        (question) =>
          question.studentAnswer?.score !== null &&
          question.studentAnswer?.score !== undefined
      ).length;

      const essayQuestions = questions.filter(
        (question) => question.type === "ESSAY"
      );

      const gradedEssays = essayQuestions.filter(
        (question) =>
          question.studentAnswer?.score !== null &&
          question.studentAnswer?.score !== undefined
      ).length;

      const currentScore = questions.reduce(
        (total, question) =>
          total + (question.studentAnswer?.score ?? 0),
        0
      );

      const maxScore = questions.reduce(
        (total, question) =>
          total + question.maxScore,
        0
      );

      res.status(200).json({
        success: true,
        message:
          "Assessment attempt retrieved successfully",
        data: {
          attempt: {
            id: attempt.id,
            status: attempt.status,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            gradedAt: attempt.gradedAt,
          },

          student: attempt.student,

          assessment: {
            id: attempt.assessment.id,
            title: attempt.assessment.title,
            type: attempt.assessment.type,
          },

          module: {
            id: attempt.assessment.module.id,
            title: attempt.assessment.module.title,
            topic: attempt.assessment.module.topic,
          },

          grading: {
            totalQuestions,
            gradedQuestions,
            totalEssays: essayQuestions.length,
            gradedEssays,
            currentScore,
            maxScore,
            isComplete:
              totalQuestions > 0 &&
              gradedQuestions === totalQuestions,
          },

          questions,
        },
      });
    } catch (error) {
      console.error(
        "Failed to retrieve assessment attempt:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to retrieve assessment attempt",
      });
    }
  }
);

 // ==========================================
 // PATCH /api/admin/assessment-answers/:answerId/grade
 // Manually grade a submitted essay answer
 // ==========================================

router.patch(
  "/assessment-answers/:answerId/grade",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedParams =
      gradeParamsSchema.safeParse(req.params);

    if (!parsedParams.success) {
      res.status(400).json({
        success: false,
        message: "Invalid answer ID",
      });
      return;
    }

    const parsedBody =
      gradeBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({
        success: false,
        message: "Invalid grading data",
        errors: parsedBody.error.flatten(),
      });
      return;
    }

    const { answerId } = parsedParams.data;
    const { score, feedback } = parsedBody.data;

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Retrieve the answer's attempt ID.
          const existing =
            await tx.assessmentAnswer.findUnique({
              where: { id: answerId },
              select: {
                attemptId: true,
              },
            });

          if (!existing) {
            throw new Error("ANSWER_NOT_FOUND");
          }

          // Lock the attempt so grading and finalization
          // cannot modify it simultaneously.
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id FROM "AssessmentAttempt"
            WHERE id = ${existing.attemptId}::uuid
            FOR UPDATE
          `;

          if (locked.length === 0) {
            throw new Error("ANSWER_NOT_FOUND");
          }

          // Read the latest answer and attempt state
          // after acquiring the lock.
          const answer =
            await tx.assessmentAnswer.findUnique({
              where: { id: answerId },
              select: {
                id: true,
                attemptId: true,
                answer: true,
                score: true,
                feedback: true,
                gradedAt: true,

                question: {
                  select: {
                    id: true,
                    type: true,
                    maxScore: true,
                    rubric: true,
                    moduleId: true,
                  },
                },

                attempt: {
                  select: {
                    status: true,
                    assessment: {
                      select: {
                        moduleId: true,
                      },
                    },
                  },
                },
              },
            });

          if (!answer) {
            throw new Error("ANSWER_NOT_FOUND");
          }

          if (answer.question.type !== "ESSAY") {
            throw new Error("NOT_ESSAY");
          }

          if (answer.attempt.status !== "PENDING_GRADING") {
            throw new Error("ATTEMPT_NOT_PENDING");
          }

          // Verify the question belongs to the
          // assessment's learning module.
          if (
            answer.question.moduleId !==
            answer.attempt.assessment.moduleId
          ) {
            throw new Error("QUESTION_MISMATCH");
          }

          if (score > answer.question.maxScore) {
            throw new Error("SCORE_EXCEEDS_MAX");
          }

          const updated =
            await tx.assessmentAnswer.update({
              where: {
                id: answerId,
              },
              data: {
                score,
                feedback,
                gradedAt: new Date(),
              },
              select: {
                id: true,
                attemptId: true,
                questionId: true,
                answer: true,
                score: true,
                feedback: true,
                gradedAt: true,
              },
            });

          return {
            ...updated,
            maxScore: answer.question.maxScore,
          };
        },
        {
          maxWait: 5000,
          timeout: 10000,
        }
      );

      res.status(200).json({
        success: true,
        message: "Essay graded successfully",
        data: result,
      });
    } catch (error) {
      const knownErrors: Record<
        string,
        { status: number; message: string }
      > = {
        ANSWER_NOT_FOUND: {
          status: 404,
          message: "Assessment answer not found",
        },
        NOT_ESSAY: {
          status: 409,
          message:
            "Only essay answers can be graded manually",
        },
        ATTEMPT_NOT_PENDING: {
          status: 409,
          message:
            "Assessment attempt is not pending grading",
        },
        QUESTION_MISMATCH: {
          status: 409,
          message:
            "Question does not belong to this assessment",
        },
        SCORE_EXCEEDS_MAX: {
          status: 400,
          message:
            "Score cannot exceed the question's maximum score",
        },
      };

      if (error instanceof Error) {
        const known = knownErrors[error.message];

        if (known) {
          res.status(known.status).json({
            success: false,
            message: known.message,
          });
          return;
        }
      }

      console.error(
        "Failed to grade essay:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to grade essay",
      });
    }
  }
);

 // ==========================================
 // POST /api/admin/assessment-attempts/:attemptId/finalize
 // Finalize a fully graded assessment
 // ==========================================

router.post(
  "/assessment-attempts/:attemptId/finalize",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedParams =
      paramsSchema.safeParse(req.params);

    if (!parsedParams.success) {
      res.status(400).json({
        success: false,
        message: "Invalid attempt ID",
      });
      return;
    }

    const { attemptId } = parsedParams.data;

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Lock the attempt to prevent concurrent
          // grading or finalization requests.
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id FROM "AssessmentAttempt"
            WHERE id = ${attemptId}::uuid
            FOR UPDATE
          `;

          if (locked.length === 0) {
            throw new Error("ATTEMPT_NOT_FOUND");
          }

          // Read the attempt after acquiring the lock.
          const attempt =
            await tx.assessmentAttempt.findUnique({
              where: {
                id: attemptId,
              },
              select: {
                id: true,
                status: true,
                assessmentId: true,
                submittedAt: true,
                assessment: {
                  select: {
                    moduleId: true,
                  },
                },
              },
            });

          if (!attempt) {
            throw new Error("ATTEMPT_NOT_FOUND");
          }

          if (attempt.status !== "PENDING_GRADING") {
            throw new Error("NOT_PENDING_GRADING");
          }

          // Retrieve all questions for the assessment.
          const questions =
            await tx.assessmentQuestion.findMany({
              where: {
                moduleId: attempt.assessment.moduleId,
              },
              select: {
                id: true,
                type: true,
                maxScore: true,
              },
            });

          if (questions.length === 0) {
            throw new Error("NO_QUESTIONS");
          }

          // Retrieve all saved student answers.
          const answers =
            await tx.assessmentAnswer.findMany({
              where: {
                attemptId,
              },
              select: {
                questionId: true,
                score: true,
                gradedAt: true,
              },
            });

          const answerMap = new Map(
            answers.map((answer) => [
              answer.questionId,
              answer,
            ])
          );

          let totalScore = 0;
          let maxScore = 0;

          // Validate every question and score.
          for (const question of questions) {
            const answer = answerMap.get(
              question.id
            );

            if (
              !answer ||
              answer.score === null ||
              answer.gradedAt === null
            ) {
              throw new Error("INCOMPLETE_GRADING");
            }

            if (
              !Number.isFinite(answer.score) ||
              !Number.isFinite(question.maxScore) ||
              question.maxScore <= 0 ||
              answer.score < 0 ||
              answer.score > question.maxScore
            ) {
              throw new Error("INVALID_SCORE");
            }

            totalScore += answer.score;
            maxScore += question.maxScore;
          }

          // Finalize only after validation succeeds.
          const finalized =
            await tx.assessmentAttempt.update({
              where: {
                id: attemptId,
              },
              data: {
                status: "GRADED",
                gradedAt: new Date(),
              },
              select: {
                id: true,
                assessmentId: true,
                status: true,
                startedAt: true,
                submittedAt: true,
                gradedAt: true,
              },
            });

          return {
            ...finalized,
            grading: {
              totalQuestions: questions.length,
              gradedQuestions: questions.length,
              totalScore,
              maxScore,
              percentage:
                Math.round(
                  (totalScore / maxScore) * 10000
                ) / 100,
            },
          };
        },
        {
          maxWait: 5000,
          timeout: 10000,
        }
      );

      res.status(200).json({
        success: true,
        message:
          "Assessment grading finalized successfully",
        data: result,
      });
    } catch (error) {
      const knownErrors: Record<
        string,
        { status: number; message: string }
      > = {
        ATTEMPT_NOT_FOUND: {
          status: 404,
          message: "Assessment attempt not found",
        },
        NOT_PENDING_GRADING: {
          status: 409,
          message:
            "Assessment is not pending grading",
        },
        NO_QUESTIONS: {
          status: 409,
          message:
            "Assessment has no questions",
        },
        INCOMPLETE_GRADING: {
          status: 409,
          message:
            "All questions must be graded before finalization",
        },
        INVALID_SCORE: {
          status: 409,
          message:
            "One or more question scores are invalid",
        },
      };

      if (error instanceof Error) {
        const known = knownErrors[error.message];

        if (known) {
          res.status(known.status).json({
            success: false,
            message: known.message,
          });
          return;
        }
      }

      console.error(
        "Failed to finalize assessment grading:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to finalize assessment grading",
      });
    }
  }
);

export default router;