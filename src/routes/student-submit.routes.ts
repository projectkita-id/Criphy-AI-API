import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import { attemptIdSchema } from "../validators/assessment-answer.validator";

const router = Router();

// ==========================================
// POST /api/student/attempts/:attemptId/submit
// Submit assigned pre-test + grade MCQs
// + transition assignment to LEARNING
// ==========================================

router.post(
  "/attempts/:attemptId/submit",
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

    // 2. Get authenticated student
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
          // ==========================================
          // 3. Lock student's active assignment
          // ==========================================

          const lockedAssignments = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id
            FROM "StudentModuleAssignment"
            WHERE "studentId" = ${studentId}::uuid
              AND "status" = 'ACTIVE'
            FOR UPDATE
          `;

          if (lockedAssignments.length === 0) {
            throw new Error("NO_ACTIVE_ASSIGNMENT");
          }

          // ==========================================
          // 4. Retrieve active assignment
          // ==========================================

          const assignment =
            await tx.studentModuleAssignment.findFirst({
              where: {
                studentId,
                status: "ACTIVE",
              },
              select: {
                id: true,
                moduleId: true,
                stage: true,
              },
            });

          if (!assignment) {
            throw new Error("NO_ACTIVE_ASSIGNMENT");
          }

          // ==========================================
          // 5. Lock attempt
          // ==========================================

          const lockedAttempts = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id
            FROM "AssessmentAttempt"
            WHERE id = ${attemptId}::uuid
              AND "studentId" = ${studentId}::uuid
            FOR UPDATE
          `;

          if (lockedAttempts.length === 0) {
            throw new Error("ATTEMPT_NOT_FOUND");
          }

          // ==========================================
          // 6. Retrieve attempt and assessment
          // ==========================================

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

          // ==========================================
          // 7. Validate assignment ownership
          // ==========================================

          if (
            assignment.moduleId !==
            attempt.assessment.moduleId
          ) {
            throw new Error("WRONG_MODULE");
          }

          if (assignment.stage !== "PRE_TEST") {
            throw new Error("INVALID_STAGE");
          }

          // ==========================================
          // 8. Validate attempt status
          // ==========================================

          if (attempt.status !== "IN_PROGRESS") {
            throw new Error("ALREADY_SUBMITTED");
          }

          // ==========================================
          // 9. Validate assessment availability
          // ==========================================

          if (
            attempt.assessment.type !== "PRE_TEST" ||
            attempt.assessment.status !== "PUBLISHED" ||
            attempt.assessment.module.status !== "PUBLISHED"
          ) {
            throw new Error("ASSESSMENT_UNAVAILABLE");
          }

          // ==========================================
          // 10. Validate assessment completeness
          // ==========================================

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

          // ==========================================
          // 11. Retrieve MCQ questions
          // ==========================================

          const mcqQuestions =
            await tx.assessmentQuestion.findMany({
              where: {
                moduleId: attempt.assessment.moduleId,
                type: "MCQ",
              },
              select: {
                id: true,
                correctAnswer: true,
                maxScore: true,
              },
            });

          const mcqAnswers =
            await tx.assessmentAnswer.findMany({
              where: {
                attemptId,
                questionId: {
                  in: mcqQuestions.map(
                    (question) => question.id
                  ),
                },
              },
              select: {
                id: true,
                questionId: true,
                answer: true,
              },
            });

          const answerMap = new Map(
            mcqAnswers.map((answer) => [
              answer.questionId,
              answer,
            ])
          );

          let mcqTotalScore = 0;
          let mcqMaxScore = 0;
          let mcqCorrectCount = 0;

          // ==========================================
          // 12. Automatically grade MCQs
          // ==========================================

          for (const question of mcqQuestions) {
            const studentAnswer = answerMap.get(
              question.id
            );

            if (!studentAnswer) {
              throw new Error("INCOMPLETE_ANSWERS");
            }

            if (!question.correctAnswer) {
              throw new Error("INVALID_ANSWER_KEY");
            }

            const isCorrect =
              studentAnswer.answer ===
              question.correctAnswer;

            const score = isCorrect
              ? question.maxScore
              : 0;

            await tx.assessmentAnswer.update({
              where: {
                id: studentAnswer.id,
              },
              data: {
                score,
                feedback: null,
                gradedAt: new Date(),
              },
            });

            mcqTotalScore += score;
            mcqMaxScore += question.maxScore;

            if (isCorrect) {
              mcqCorrectCount++;
            }
          }

          // ==========================================
          // 13. Submit pre-test
          // ==========================================

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

          // ==========================================
          // 14. Transition assignment to LEARNING
          // ==========================================

          const updatedAssignment =
            await tx.studentModuleAssignment.update({
              where: {
                id: assignment.id,
              },
              data: {
                stage: "LEARNING",
              },
              select: {
                id: true,
                moduleId: true,
                status: true,
                stage: true,
              },
            });

          // ==========================================
          // 15. Return transaction result
          // ==========================================

          return {
            ...submitted,
            totalQuestions,
            answeredQuestions,
            mcqGrading: {
              totalQuestions: mcqQuestions.length,
              correctAnswers: mcqCorrectCount,
              score: mcqTotalScore,
              maxScore: mcqMaxScore,
            },
            moduleAssignment: updatedAssignment,
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
          "Pre-test submitted successfully. Learning phase is now available.",
        data: result,
      });
    } catch (error) {
      // ==========================================
      // Error handling
      // ==========================================

      const knownErrors: Record<
        string,
        { status: number; message: string }
      > = {
        ATTEMPT_NOT_FOUND: {
          status: 404,
          message: "Assessment attempt not found",
        },
        NO_ACTIVE_ASSIGNMENT: {
          status: 403,
          message:
            "You do not have an active module assignment",
        },
        WRONG_MODULE: {
          status: 403,
          message:
            "This assessment does not belong to your assigned module",
        },
        INVALID_STAGE: {
          status: 409,
          message:
            "Your module assignment is not at the pre-test stage",
        },
        ALREADY_SUBMITTED: {
          status: 409,
          message:
            "Assessment has already been submitted",
        },
        ASSESSMENT_UNAVAILABLE: {
          status: 409,
          message:
            "Assessment is no longer available",
        },
        INCOMPLETE_ANSWERS: {
          status: 409,
          message:
            "All questions must be answered before submission",
        },
        INVALID_ANSWER_KEY: {
          status: 409,
          message:
            "One or more MCQ questions have an invalid answer key",
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
        "Failed to submit pre-test:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to submit pre-test",
      });
    }
  }
);

export default router;