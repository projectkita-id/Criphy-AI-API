import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import { Prisma } from "../generated/prisma/client";
import { attemptIdSchema } from "../validators/assessment-answer.validator";
import { AIEvaluationService } from "../services/ai-evaluation.service";
import { getOrCreatePhaseEvaluation } from "../services/learning-evaluation.helper";

const router = Router();


// ==========================================
// POST /api/student/attempts/:attemptId/submit
// Submit pre-test or post-test, grade MCQs,
// and advance the student's module assignment
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
          // 4. Retrieve active assignment
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
          // 5. Lock student's attempt
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
                        case: {
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
                          },
                        },
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

          // ==========================================
          // 8. Validate learning stage
          // ==========================================

          const assessmentType =
            attempt.assessment.type;

          const requiredStage =
            assessmentType === "PRE_TEST"
              ? "PRE_TEST"
              : "POST_TEST";

          if (assignment.stage !== requiredStage) {
            throw new Error("INVALID_STAGE");
          }

          // ==========================================
          // 9. Validate attempt status
          // ==========================================

          if (attempt.status !== "IN_PROGRESS") {
            throw new Error("ALREADY_SUBMITTED");
          }

          // ==========================================
          // 10. Validate assessment availability
          // ==========================================

          if (
            attempt.assessment.status !== "PUBLISHED" ||
            attempt.assessment.module.status !== "PUBLISHED"
          ) {
            throw new Error("ASSESSMENT_UNAVAILABLE");
          }

          // ==========================================
          // 11. Verify post-test prerequisites
          // ==========================================

          if (assessmentType === "POST_TEST") {
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
          // 12. Validate answer completeness
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
          // 13. Retrieve MCQ questions and answers
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
          // 14. Automatically grade MCQs
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
          // 14b. Automatically grade Essay questions with AI
          // ==========================================

          const essayQuestions =
            await tx.assessmentQuestion.findMany({
              where: {
                moduleId: attempt.assessment.moduleId,
                type: "ESSAY",
              },
              select: {
                id: true,
                questionText: true,
                rubric: true,
                maxScore: true,
                indicator: true,
              },
            });

          const essayAnswers =
            await tx.assessmentAnswer.findMany({
              where: {
                attemptId,
                questionId: {
                  in: essayQuestions.map((q) => q.id),
                },
              },
              select: {
                id: true,
                questionId: true,
                answer: true,
              },
            });

          const caseContext = {
            id: attempt.assessment.module.case.id,
            possibleMisconceptions: attempt.assessment.module.case.possibleMisconceptions,
            title: attempt.assessment.module.case.title,
            context: attempt.assessment.module.case.context,
            topic: attempt.assessment.module.case.topic,
            stimulus: attempt.assessment.module.case.stimulus,
            scientificData: attempt.assessment.module.case.scientificData,
            targetConcept: attempt.assessment.module.case.targetConcept,
            expertAnswer: attempt.assessment.module.case.expertAnswer,
          };

          let essayTotalScore = 0;
          let essayMaxScore = 0;

          // Grade all essays in parallel to keep the transaction short.
          const essayGradingResults = await Promise.all(
            essayQuestions.map(async (question) => {
              const studentAnswer = essayAnswers.find(
                (ans) => ans.questionId === question.id
              );

              if (!studentAnswer) {
                throw new Error("INCOMPLETE_ANSWERS");
              }

              const graded =
                await AIEvaluationService.gradeEssayAnswer({
                  questionText: question.questionText,
                  rubric: question.rubric,
                  maxScore: question.maxScore,
                  indicator: question.indicator,
                  studentAnswer: studentAnswer.answer,
                  caseStudy: caseContext,
                });

              return { question, studentAnswer, graded };
            })
          );

          for (const { question, studentAnswer, graded } of essayGradingResults) {
            await tx.assessmentAnswer.update({
              where: {
                id: studentAnswer.id,
              },
              data: {
                score: graded.score,
                feedback: graded.feedback,
                gradedAt: new Date(),
              },
            });

            essayTotalScore += graded.score;
            essayMaxScore += question.maxScore;
          }

          // ==========================================
          // 14c. If Post-Test: Grade pending Pre-Test essays & evaluate Phases 1-5
          // ==========================================

          const isPostTest =
            assessmentType === "POST_TEST";

          let phaseEvaluationResult = null;

          if (isPostTest) {
            // Ensure pre-test essay questions are also fully graded
            const preTestAttempt =
              await tx.assessmentAttempt.findFirst({
                where: {
                  studentId,
                  assessment: {
                    moduleId: attempt.assessment.moduleId,
                    type: "PRE_TEST",
                  },
                },
                include: {
                  answers: {
                    include: {
                      question: true,
                    },
                  },
                },
              });

            if (preTestAttempt) {
              let preUpdated = false;
              const pendingPre = preTestAttempt.answers.filter(
                (preAns) =>
                  preAns.question.type === "ESSAY" &&
                  preAns.score === null
              );
              const gradedPreList = await Promise.all(
                pendingPre.map((preAns) =>
                  AIEvaluationService.gradeEssayAnswer({
                      questionText: preAns.question.questionText,
                      rubric: preAns.question.rubric,
                      maxScore: preAns.question.maxScore,
                      indicator: preAns.question.indicator,
                      studentAnswer: preAns.answer,
                      caseStudy: caseContext,
                    })
                )
              );

              for (let index = 0; index < pendingPre.length; index++) {
                const gradedPre = gradedPreList[index];

                await tx.assessmentAnswer.update({
                  where: { id: pendingPre[index].id },
                  data: {
                    score: gradedPre.score,
                    feedback: gradedPre.feedback,
                    gradedAt: new Date(),
                  },
                });
                preUpdated = true;
              }

              if (preUpdated || preTestAttempt.status !== "GRADED") {
                await tx.assessmentAttempt.update({
                  where: { id: preTestAttempt.id },
                  data: {
                    status: "GRADED",
                    gradedAt: new Date(),
                  },
                });
              }
            }

            // Evaluate 5 learning phases
            const session =
              await tx.learningSession.findUnique({
                where: {
                  assignmentId: assignment.id,
                },
                include: {
                  phases: {
                    orderBy: {
                      phaseNumber: "asc",
                    },
                    include: {
                      responses: {
                        orderBy: {
                          createdAt: "asc",
                        },
                      },
                      submission: true,
                    },
                  },
                },
              });

            if (session) {
              phaseEvaluationResult =
                await getOrCreatePhaseEvaluation(
                  tx,
                  session.phases,
                  caseContext
                );
            }
          }

          // ==========================================
          // 15. Submit and finalize assessment attempt
          // ==========================================

          const submittedAt = new Date();

          const submitted =
            await tx.assessmentAttempt.update({
              where: {
                id: attemptId,
              },
              data: {
                status: "GRADED",
                submittedAt,
                gradedAt: submittedAt,
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

          // ==========================================
          // 16. Advance module assignment
          // ==========================================

          const updatedAssignment =
            await tx.studentModuleAssignment.update({
              where: {
                id: assignment.id,
              },
              data: isPostTest
                ? {
                    stage: "COMPLETED",
                    status: "COMPLETED",
                    completedAt: submittedAt,
                  }
                : {
                    stage: "LEARNING",
                  },
              select: {
                id: true,
                moduleId: true,
                status: true,
                stage: true,
                completedAt: true,
              },
            });

          // Total score for this attempt
          const totalScore =
            Math.round((mcqTotalScore + essayTotalScore) * 100) / 100;
          const maxScore = mcqMaxScore + essayMaxScore;
          const percentage =
            maxScore > 0
              ? Math.round((totalScore / maxScore) * 10000) / 100
              : 0;

          // ==========================================
          // 17. Return transaction result
          // ==========================================

          return {
            ...submitted,
            assessmentType,
            totalQuestions,
            answeredQuestions,
            totalScore,
            maxScore,
            percentage,
            mcqGrading: {
              totalQuestions: mcqQuestions.length,
              correctAnswers: mcqCorrectCount,
              score: mcqTotalScore,
              maxScore: mcqMaxScore,
              percentage:
                mcqMaxScore > 0
                  ? Math.round((mcqTotalScore / mcqMaxScore) * 10000) / 100
                  : 0,
            },
            essayGrading: {
              totalQuestions: essayQuestions.length,
              score: essayTotalScore,
              maxScore: essayMaxScore,
              percentage:
                essayMaxScore > 0
                  ? Math.round((essayTotalScore / essayMaxScore) * 10000) / 100
                  : 0,
              results: essayGradingResults.map(
                ({ question, graded }) => ({
                  questionId: question.id,
                  score: graded.score,
                  maxScore: question.maxScore,
                  feedback: graded.feedback,
                  relevance: graded.relevance,
                })
              ),
            },
            phaseEvaluation: phaseEvaluationResult,
            moduleAssignment: updatedAssignment,
          };
        },
        {
          maxWait: 15000,
          timeout: 120000,
        }
      );

      // ==========================================
      // 18. Return successful response
      // ==========================================

      const isPostTest =
        result.assessmentType === "POST_TEST";

      res.status(200).json({
        success: true,
        message: isPostTest
          ? "Post-test submitted successfully. Module completed."
          : "Pre-test submitted successfully. Learning phase is now available.",
        data: result,
      });
    } catch (error) {
      // ==========================================
      // 19. Handle expected errors
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
        ALREADY_SUBMITTED: {
          status: 409,
          message:
            "Asesmen ini sudah kamu kumpulkan sebelumnya.",
        },
        ASSESSMENT_UNAVAILABLE: {
          status: 409,
          message:
            "Asesmen ini sudah tidak tersedia.",
        },
        LEARNING_NOT_COMPLETED: {
          status: 409,
          message:
            "Selesaikan kelima fase pembelajaran terlebih dahulu sebelum post-test.",
        },
        INCOMPLETE_ANSWERS: {
          status: 409,
          message:
            "Semua soal wajib dijawab sebelum dikumpulkan.",
        },
        INVALID_ANSWER_KEY: {
          status: 409,
          message:
            "Ada soal pilihan ganda dengan kunci jawaban tidak valid. Hubungi guru/admin.",
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
        message: "Gagal mengumpulkan asesmen. Coba lagi beberapa saat lagi.",
      });
    }
  }
);
export default router;