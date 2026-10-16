import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import {
  attemptIdSchema,
  saveAssessmentAnswersSchema,
} from "../validators/assessment-answer.validator";

const router = Router();

// ==========================================
// PUT /api/student/attempts/:attemptId/answers
// Save multiple answers in one transaction
// ==========================================

router.put(
  "/attempts/:attemptId/answers",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    // 1. Validate attempt ID
    const parsedId = attemptIdSchema.safeParse(
      req.params.attemptId
    );

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid attempt ID",
      });
      return;
    }

    // 2. Validate request body
    const parsedBody = saveAssessmentAnswersSchema.safeParse(
      req.body
    );

    if (!parsedBody.success) {
      res.status(400).json({
        success: false,
        message: "Invalid answers",
        errors: parsedBody.error.flatten(),
      });
      return;
    }

    const attemptId = parsedId.data;
    const answers = parsedBody.data.answers;

    // 3. Use the authenticated student's ID
    const studentId: string | undefined =
      res.locals.user?.id;

    if (!studentId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    try {
      const savedAnswers = await prisma.$transaction(
        async (tx) => {
          // Lock attempt to prevent concurrent writes
          // and coordinate with future submission.
          const lockedAttempts = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id FROM "AssessmentAttempt"
            WHERE id = ${attemptId}::uuid
              AND "studentId" = ${studentId}::uuid
            FOR UPDATE
          `;

          if (lockedAttempts.length === 0) {
            throw new Error("ATTEMPT_NOT_FOUND");
          }

          // 4. Verify attempt ownership and status
          const attempt =
            await tx.assessmentAttempt.findFirst({
              where: {
                id: attemptId,
                studentId,
              },
              select: {
                id: true,
                status: true,
                assessment: {
                  select: {
                    moduleId: true,
                    type: true,
                    status: true,
                    module: {
                      select: {
                        status: true,
                      },
                    },
                  },
                },
              },
            });

          if (!attempt) {
            throw new Error("ATTEMPT_NOT_FOUND");
          }

          if (attempt.status !== "IN_PROGRESS") {
            throw new Error("ATTEMPT_NOT_EDITABLE");
          }

          if (
            attempt.assessment.type !== "PRE_TEST" ||
            attempt.assessment.status !== "PUBLISHED" ||
            attempt.assessment.module.status !== "PUBLISHED"
          ) {
            throw new Error("ASSESSMENT_UNAVAILABLE");
          }

          // 5. Fetch all submitted question IDs
          const questionIds = answers.map(
            (item) => item.questionId
          );

          const questions =
            await tx.assessmentQuestion.findMany({
              where: {
                id: { in: questionIds },
                moduleId: attempt.assessment.moduleId,
              },
              select: {
                id: true,
                type: true,
                options: true,
              },
            });

          if (questions.length !== questionIds.length) {
            throw new Error("QUESTION_NOT_FOUND");
          }

          const questionMap = new Map(
            questions.map((question) => [
              question.id,
              question,
            ])
          );

          // 6. Validate every submitted answer
          for (const item of answers) {
            const question = questionMap.get(
              item.questionId
            );

            if (!question) {
              throw new Error("QUESTION_NOT_FOUND");
            }

            if (question.type === "MCQ") {
              if (!Array.isArray(question.options)) {
                throw new Error("INVALID_QUESTION_OPTIONS");
              }

              const validKeys = question.options
                .filter(
                  (option): option is {
                    key: string;
                    text: string;
                  } =>
                    typeof option === "object" &&
                    option !== null &&
                    !Array.isArray(option) &&
                    typeof option.key === "string" &&
                    typeof option.text === "string"
                )
                .map((option) => option.key);

              if (!validKeys.includes(item.answer)) {
                throw new Error("INVALID_MCQ_ANSWER");
              }
            }
          }

          // 7. Create or update all answers
          // Every operation belongs to one transaction.
          const results = [];

          for (const item of answers) {
            const saved =
              await tx.assessmentAnswer.upsert({
                where: {
                  attemptId_questionId: {
                    attemptId,
                    questionId: item.questionId,
                  },
                },
                create: {
                  attemptId,
                  questionId: item.questionId,
                  answer: item.answer,
                },
                update: {
                  answer: item.answer,
                },
                select: {
                  id: true,
                  questionId: true,
                  answer: true,
                },
              });

            results.push(saved);
          }

          return results;
        },
        {
          maxWait: 5000,
          timeout: 10000,
        }
      );

      res.status(200).json({
        success: true,
        message: "Answers saved successfully",
        data: {
          attemptId,
          savedCount: savedAnswers.length,
          answers: savedAnswers,
        },
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
        ATTEMPT_NOT_EDITABLE: {
          status: 409,
          message: "This assessment attempt is no longer editable",
        },
        ASSESSMENT_UNAVAILABLE: {
          status: 409,
          message: "Assessment is no longer available",
        },
        QUESTION_NOT_FOUND: {
          status: 404,
          message: "One or more questions do not belong to this assessment",
        },
        INVALID_QUESTION_OPTIONS: {
          status: 409,
          message: "One or more questions have invalid options",
        },
        INVALID_MCQ_ANSWER: {
          status: 400,
          message: "One or more MCQ answers are invalid",
        },
      };

      if (error instanceof Error) {
        const knownError = knownErrors[error.message];

        if (knownError) {
          res.status(knownError.status).json({
            success: false,
            message: knownError.message,
          });
          return;
        }
      }

      console.error(
        "Failed to save student answers:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to save answers",
      });
    }
  }
);

router.get(
  "/attempts/:attemptId/answers",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    const parsedId = attemptIdSchema.safeParse(
      req.params.attemptId
    );

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid attempt ID",
      });
      return;
    }

    const studentId: string | undefined =
      res.locals.user?.id;

    if (!studentId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    try {
      const attempt =
        await prisma.assessmentAttempt.findFirst({
          where: {
            id: parsedId.data,
            studentId,
          },
          select: {
            id: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            assessment: {
              select: {
                id: true,
                type: true,
                status: true,
                module: {
                  select: {
                    status: true,
                  },
                },
              },
            },
            answers: {
              select: {
                id: true,
                questionId: true,
                answer: true,
              },
              orderBy: {
                question: {
                  order: "asc",
                },
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

      if (
        attempt.assessment.type !== "PRE_TEST" ||
        attempt.assessment.status !== "PUBLISHED" ||
        attempt.assessment.module.status !== "PUBLISHED"
      ) {
        res.status(409).json({
          success: false,
          message: "Assessment is no longer available",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Saved answers retrieved successfully",
        data: {
          attemptId: attempt.id,
          status: attempt.status,
          startedAt: attempt.startedAt,
          submittedAt: attempt.submittedAt,
          savedCount: attempt.answers.length,
          answers: attempt.answers,
        },
      });
    } catch (error) {
      console.error(
        "Failed to retrieve saved answers:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve saved answers",
      });
    }
  }
);

export default router;