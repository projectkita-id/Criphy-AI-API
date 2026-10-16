import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import { attemptIdSchema } from "../validators/assessment-answer.validator";

const router = Router();

router.post(
  "/attempts/:attemptId/submit",
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

    const attemptId = parsedId.data;

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Lock the attempt to prevent simultaneous
          // saving and submission.
          const locked = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id FROM "AssessmentAttempt"
            WHERE id = ${attemptId}::uuid
              AND "studentId" = ${studentId}::uuid
            FOR UPDATE
          `;

          if (locked.length === 0) {
            throw new Error("ATTEMPT_NOT_FOUND");
          }

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
                    id: true,
                    type: true,
                    status: true,
                    moduleId: true,
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
            throw new Error("ALREADY_SUBMITTED");
          }

          if (
            attempt.assessment.type !== "PRE_TEST" ||
            attempt.assessment.status !== "PUBLISHED" ||
            attempt.assessment.module.status !== "PUBLISHED"
          ) {
            throw new Error("ASSESSMENT_UNAVAILABLE");
          }

          // All questions belong to the learning module.
          const totalQuestions =
            await tx.assessmentQuestion.count({
              where: {
                moduleId: attempt.assessment.moduleId,
              },
            });

          const answeredQuestions =
            await tx.assessmentAnswer.count({
              where: {
                attemptId,
                question: {
                  moduleId: attempt.assessment.moduleId,
                },
              },
            });

          if (
            totalQuestions === 0 ||
            answeredQuestions !== totalQuestions
          ) {
            throw new Error("INCOMPLETE_ANSWERS");
          }

          const submitted =
            await tx.assessmentAttempt.update({
              where: {
                id: attemptId,
              },
              data: {
                status: "PENDING_GRADING",
                submittedAt: new Date(),
              },
              select: {
                id: true,
                assessmentId: true,
                status: true,
                startedAt: true,
                submittedAt: true,
              },
            });

          return {
            ...submitted,
            totalQuestions,
            answeredQuestions,
          };
        },
        {
          maxWait: 5000,
          timeout: 10000,
        }
      );

      res.status(200).json({
        success: true,
        message: "Assessment submitted successfully",
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
        ALREADY_SUBMITTED: {
          status: 409,
          message: "Assessment has already been submitted",
        },
        ASSESSMENT_UNAVAILABLE: {
          status: 409,
          message: "Assessment is no longer available",
        },
        INCOMPLETE_ANSWERS: {
          status: 409,
          message: "All questions must be answered before submission",
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
        "Failed to submit assessment:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to submit assessment",
      });
    }
  }
);

export default router;