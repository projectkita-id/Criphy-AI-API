import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import { Prisma } from "../generated/prisma/client";
import { attemptIdSchema } from "../validators/assessment-answer.validator";
import { AIEvaluationService } from "../services/ai-evaluation.service";

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
          const essayGradingResults = [];

          for (const question of essayQuestions) {
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
            essayGradingResults.push({
              questionId: question.id,
              score: graded.score,
              maxScore: question.maxScore,
              feedback: graded.feedback,
            });
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
              for (const preAns of preTestAttempt.answers) {
                if (
                  preAns.question.type === "ESSAY" &&
                  preAns.score === null
                ) {
                  const gradedPre =
                    await AIEvaluationService.gradeEssayAnswer({
                      questionText: preAns.question.questionText,
                      rubric: preAns.question.rubric,
                      maxScore: preAns.question.maxScore,
                      indicator: preAns.question.indicator,
                      studentAnswer: preAns.answer,
                      caseStudy: caseContext,
                    });

                  await tx.assessmentAnswer.update({
                    where: { id: preAns.id },
                    data: {
                      score: gradedPre.score,
                      feedback: gradedPre.feedback,
                      gradedAt: new Date(),
                    },
                  });
                  preUpdated = true;
                }
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
              const p1 = session.phases.find(
                (p) => p.phaseNumber === 1
              );
              const p2 = session.phases.find(
                (p) => p.phaseNumber === 2
              );
              const p3 = session.phases.find(
                (p) => p.phaseNumber === 3
              );
              const p4 = session.phases.find(
                (p) => p.phaseNumber === 4
              );
              const p5 = session.phases.find(
                (p) => p.phaseNumber === 5
              );

              const p1Content = p1?.submission
                ?.content as Record<string, unknown> | null;
              const p4Content = p4?.submission
                ?.content as Record<string, unknown> | null;
              const p5Content = p5?.submission
                ?.content as Record<string, unknown> | null;

              phaseEvaluationResult =
                await AIEvaluationService.evaluateLearningPhases({
                  caseStudy: caseContext,
                  phase1: p1Content
                    ? {
                        prediction:
                          typeof p1Content.prediction === "string"
                            ? p1Content.prediction
                            : null,
                        reasoning:
                          typeof p1Content.reasoning === "string"
                            ? p1Content.reasoning
                            : null,
                        confidence:
                          typeof p1Content.confidence === "string"
                            ? p1Content.confidence
                            : null,
                      }
                    : p1?.responses[0]
                      ? { prediction: p1.responses[0].answer }
                      : null,
                  phase2Responses: p2?.responses.map((r) => ({
                    answer: r.answer,
                    aiFeedback: r.aiFeedback,
                  })),
                  phase3Responses: p3?.responses.map((r) => ({
                    answer: r.answer,
                    aiFeedback: r.aiFeedback,
                  })),
                  phase4Submission: p4Content as any,
                  phase5Submission: p5Content as any,
                });

              // Store phase evaluation into Phase 5 submission content
              if (p5?.submission) {
                await tx.learningPhaseSubmission.update({
                  where: { id: p5.submission.id },
                  data: {
                    content: {
                      ...(p5Content || {}),
                      aiEvaluation:
                        phaseEvaluationResult as unknown as Prisma.InputJsonValue,
                    } as Prisma.InputJsonObject,
                  },
                });
              }
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
              results: essayGradingResults,
            },
            phaseEvaluation: phaseEvaluationResult,
            moduleAssignment: updatedAssignment,
          };
        },
        {
          maxWait: 15000,
          timeout: 45000,
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
            "This assessment is not available at your current learning stage",
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
        LEARNING_NOT_COMPLETED: {
          status: 409,
          message:
            "All five learning phases must be completed before submitting the post-test",
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