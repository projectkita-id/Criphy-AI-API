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
// Save pre-test or post-test answers
// ==========================================

router.put(
  "/attempts/:attemptId/answers",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    // ==========================================
    // 1. Validate attempt ID
    // ==========================================

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

    // ==========================================
    // 2. Validate request body
    // ==========================================

    const parsedBody = saveAssessmentAnswersSchema.safeParse(
      req.body
    );

    if (!parsedBody.success) {
      res.status(400).json({
        success: false,
        message: "Format jawaban tidak valid.",
        errors: parsedBody.error.flatten(),
      });
      return;
    }

    const attemptId = parsedId.data;
    const answers = parsedBody.data.answers;

    // ==========================================
    // 3. Get authenticated student
    // ==========================================

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
          // ==========================================
          // 4. Lock active assignment first
          // Keep lock order consistent with submission
          // ==========================================

          const lockedAssignments = await tx.$queryRaw<
            { id: string }[]
          >`
            SELECT id
            FROM "StudentModuleAssignment"
            WHERE "studentId" = ${studentId}::uuid
              AND "status" = 'ACTIVE'
              AND "moduleId" = (
                SELECT a."moduleId"
                FROM "AssessmentAttempt" t
                JOIN "Assessment" a ON a.id = t."assessmentId"
                WHERE t.id = ${attemptId}::uuid
              )
            FOR UPDATE
          `;

          if (lockedAssignments.length === 0) {
            throw new Error("NO_ACTIVE_ASSIGNMENT");
          }

          // ==========================================
          // 5. Retrieve active assignment
          // ==========================================

          const assignment =
            await tx.studentModuleAssignment.findFirst({
              where: {
                id: lockedAssignments[0].id,
              },
              select: {
                id: true,
                moduleId: true,
                stage: true,
                learningSession: {
                  select: {
                    status: true,
                    phases: {
                      select: {
                        phaseNumber: true,
                        status: true,
                      },
                    },
                  },
                },
              },
            });

          if (!assignment) {
            throw new Error("NO_ACTIVE_ASSIGNMENT");
          }

          // ==========================================
          // 6. Lock attempt
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
          // 7. Retrieve attempt and assessment
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

          // ==========================================
          // 8. Verify attempt is editable
          // ==========================================

          if (attempt.status !== "IN_PROGRESS") {
            throw new Error("ATTEMPT_NOT_EDITABLE");
          }

          // ==========================================
          // 9. Verify assessment availability
          // ==========================================

          if (
            attempt.assessment.status !== "PUBLISHED" ||
            attempt.assessment.module.status !== "PUBLISHED"
          ) {
            throw new Error("ASSESSMENT_UNAVAILABLE");
          }

          // ==========================================
          // 10. Verify assigned module
          // ==========================================

          if (
            assignment.moduleId !==
            attempt.assessment.moduleId
          ) {
            throw new Error("WRONG_MODULE");
          }

          // ==========================================
          // 11. Verify learning stage
          // ==========================================

          const requiredStage =
            attempt.assessment.type === "PRE_TEST"
              ? "PRE_TEST"
              : "POST_TEST";

          if (assignment.stage !== requiredStage) {
            throw new Error("INVALID_STAGE");
          }

          // ==========================================
          // 12. Verify post-test prerequisites
          // ==========================================

          if (attempt.assessment.type === "POST_TEST") {
            const session = assignment.learningSession;

            if (
              !session ||
              session.status !== "COMPLETED" ||
              session.phases.length !== 5 ||
              session.phases.some(
                (phase) => phase.status !== "COMPLETED"
              ) ||
              new Set(
                session.phases.map(
                  (phase) => phase.phaseNumber
                )
              ).size !== 5
            ) {
              throw new Error("LEARNING_NOT_COMPLETED");
            }
          }

          // ==========================================
          // 13. Fetch submitted questions
          // ==========================================

          const questionIds = answers.map(
            (item) => item.questionId
          );

          const questions =
            await tx.assessmentQuestion.findMany({
              where: {
                id: {
                  in: questionIds,
                },
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

          // ==========================================
          // 14. Validate submitted answers
          // ==========================================

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

          // ==========================================
          // 15. Save or update answers
          // ==========================================

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
                  score: null,
                  feedback: null,
                  gradedAt: null,
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

      // ==========================================
      // 16. Return saved answers
      // ==========================================

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
      // ==========================================
      // 17. Handle expected errors
      // ==========================================

      const knownErrors: Record<
        string,
        { status: number; message: string }
      > = {
        ATTEMPT_NOT_FOUND: {
          status: 404,
          message: "Data pengerjaan asesmen tidak ditemukan. Muat ulang halaman lalu coba lagi.",
        },
        NO_ACTIVE_ASSIGNMENT: {
          status: 403,
          message:
            "Modul untuk asesmen ini belum aktif. Pilih kembali konteks pembelajaranmu.",
        },
        WRONG_MODULE: {
          status: 403,
          message:
            "Asesmen ini bukan bagian dari modul yang sedang kamu kerjakan.",
        },
        INVALID_STAGE: {
          status: 409,
          message:
            "Asesmen ini belum bisa dikerjakan pada tahap belajarmu saat ini.",
        },
        LEARNING_NOT_COMPLETED: {
          status: 409,
          message:
            "Selesaikan kelima fase pembelajaran terlebih dahulu sebelum post-test.",
        },
        ATTEMPT_NOT_EDITABLE: {
          status: 409,
          message:
            "Jawaban asesmen ini sudah tidak bisa diubah.",
        },
        ASSESSMENT_UNAVAILABLE: {
          status: 409,
          message: "Asesmen ini sudah tidak tersedia.",
        },
        QUESTION_NOT_FOUND: {
          status: 404,
          message:
            "Ada soal yang bukan bagian dari asesmen ini. Muat ulang halaman.",
        },
        INVALID_QUESTION_OPTIONS: {
          status: 409,
          message:
            "Ada soal dengan pilihan jawaban tidak valid. Hubungi guru/admin.",
        },
        INVALID_MCQ_ANSWER: {
          status: 400,
          message:
            "Ada jawaban pilihan ganda yang tidak valid.",
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
        message: "Gagal menyimpan jawaban. Coba lagi beberapa saat lagi.",
      });
    }
  }
);

// ==========================================
// GET /api/student/attempts/:attemptId/answers
// Retrieve saved pre-test or post-test answers
// ==========================================

router.get(
  "/attempts/:attemptId/answers",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    // ==========================================
    // 1. Validate attempt ID
    // ==========================================

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

    // ==========================================
    // 2. Get authenticated student
    // ==========================================

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
      // ==========================================
      // 3. Retrieve owned assessment attempt
      // ==========================================

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
          message: "Data pengerjaan asesmen tidak ditemukan. Muat ulang halaman lalu coba lagi.",
        });
        return;
      }

      // ==========================================
      // 4. Verify assessment availability
      // ==========================================

      if (
        attempt.assessment.status !== "PUBLISHED" ||
        attempt.assessment.module.status !== "PUBLISHED"
      ) {
        res.status(409).json({
          success: false,
          message: "Asesmen ini sudah tidak tersedia.",
        });
        return;
      }

      // ==========================================
      // 5. Return saved answers
      // ==========================================

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