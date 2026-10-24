import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import { attemptIdSchema } from "../validators/assessment-answer.validator";
import { AIEvaluationService } from "../services/ai-evaluation.service";

const router = Router();

// ==========================================
// GET /api/student/attempts/:attemptId/results
// Retrieve finalized assessment results, grading essays with AI if pending,
// and attaching comprehensive learning progression data.
// ==========================================

router.get(
  "/attempts/:attemptId/results",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    const parsedId = attemptIdSchema.safeParse(req.params.attemptId);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid attempt ID",
      });
      return;
    }

    const studentId: string | undefined = res.locals.user?.id;

    if (!studentId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const attemptId = parsedId.data;

    try {
      const attempt = await prisma.assessmentAttempt.findFirst({
        where: {
          id: attemptId,
          studentId,
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
              module: {
                select: {
                  id: true,
                  title: true,
                  topic: true,
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
                  assessmentQuestions: {
                    orderBy: {
                      order: "asc",
                    },
                    select: {
                      id: true,
                      type: true,
                      order: true,
                      questionText: true,
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
          message: "Assessment result not found",
        });
        return;
      }

      // If attempt is still in progress and not submitted yet
      if (
        attempt.status !== "PENDING_GRADING" &&
        attempt.status !== "GRADED" &&
        !attempt.submittedAt
      ) {
        res.status(409).json({
          success: false,
          message: "Assessment results are not available yet",
        });
        return;
      }

      // ==========================================
      // Match student answers to questions
      // ==========================================

      const answerMap = new Map(
        attempt.answers.map((answer) => [answer.questionId, answer])
      );

      const caseData = attempt.assessment.module.case;
      const caseContext = {
        title: caseData?.title || attempt.assessment.module.title,
        context: caseData?.context || "DAILY_LIFE",
        topic: caseData?.topic || attempt.assessment.module.topic,
        stimulus: caseData?.stimulus || "",
        scientificData: caseData?.scientificData,
        targetConcept: caseData?.targetConcept,
        expertAnswer: caseData?.expertAnswer,
      };

      // Ensure any ungraded essay answers get graded by AI
      let hasGradedAnyPendingEssay = false;
      for (const question of attempt.assessment.module.assessmentQuestions) {
        if (question.type === "ESSAY") {
          const studentAnswer = answerMap.get(question.id);
          if (studentAnswer && studentAnswer.score === null) {
            const graded = await AIEvaluationService.gradeEssayAnswer({
              questionText: question.questionText,
              rubric: question.rubric,
              maxScore: question.maxScore,
              indicator: question.indicator,
              studentAnswer: studentAnswer.answer,
              caseStudy: caseContext,
            });

            await prisma.assessmentAnswer.update({
              where: { id: studentAnswer.id },
              data: {
                score: graded.score,
                feedback: graded.feedback,
                gradedAt: new Date(),
              },
            });

            studentAnswer.score = graded.score;
            studentAnswer.feedback = graded.feedback;
            studentAnswer.gradedAt = new Date();
            hasGradedAnyPendingEssay = true;
          }
        }
      }

      if (hasGradedAnyPendingEssay && attempt.status !== "GRADED") {
        await prisma.assessmentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "GRADED",
            gradedAt: new Date(),
          },
        });
        attempt.status = "GRADED";
        attempt.gradedAt = new Date();
      }

      const questions = attempt.assessment.module.assessmentQuestions.map(
        (question) => {
          const studentAnswer = answerMap.get(question.id);

          return {
            id: question.id,
            type: question.type,
            order: question.order,
            questionText: question.questionText,
            indicator: question.indicator,
            maxScore: question.maxScore,
            rubric: question.rubric,
            options: question.options,
            studentAnswer: studentAnswer
              ? {
                  answer: studentAnswer.answer,
                  score: studentAnswer.score,
                  feedback: studentAnswer.feedback,
                  gradedAt: studentAnswer.gradedAt,
                  isCorrect:
                    question.type === "MCQ"
                      ? studentAnswer.answer === question.correctAnswer
                      : null,
                }
              : null,
          };
        }
      );

      // ==========================================
      // Calculate scores (MCQ, Essay, Total)
      // ==========================================

      const mcqQuestions = questions.filter((q) => q.type === "MCQ");
      const essayQuestions = questions.filter((q) => q.type === "ESSAY");

      const mcqTotalScore = mcqQuestions.reduce(
        (total, q) => total + (q.studentAnswer?.score ?? 0),
        0
      );
      const mcqMaxScore = mcqQuestions.reduce(
        (total, q) => total + q.maxScore,
        0
      );
      const mcqPercentage =
        mcqMaxScore > 0
          ? Math.round((mcqTotalScore / mcqMaxScore) * 10000) / 100
          : 0;

      const essayTotalScore = essayQuestions.reduce(
        (total, q) => total + (q.studentAnswer?.score ?? 0),
        0
      );
      const essayMaxScore = essayQuestions.reduce(
        (total, q) => total + q.maxScore,
        0
      );
      const essayPercentage =
        essayMaxScore > 0
          ? Math.round((essayTotalScore / essayMaxScore) * 10000) / 100
          : 0;

      const totalScore = Math.round((mcqTotalScore + essayTotalScore) * 100) / 100;
      const maxScore = mcqMaxScore + essayMaxScore;
      const percentage =
        maxScore > 0
          ? Math.round((totalScore / maxScore) * 10000) / 100
          : 0;

      let recommendation: {
        status: "MASTERY" | "NEEDS_REINFORCEMENT";
        action: "MY_PROGRESS" | "CASE_CHALLENGE";
        message: string;
      } | null = null;

      if (attempt.assessment.type === "POST_TEST") {
        if (percentage >= 80) {
          recommendation = {
            status: "MASTERY",
            action: "MY_PROGRESS",
            message:
              "Selamat! Kamu telah mencapai tingkat penguasaan berpikir kritis yang sangat baik (≥80%). Pemahaman konsep dan penalaran ilmiahmu berkembang optimal.",
          };
        } else {
          recommendation = {
            status: "NEEDS_REINFORCEMENT",
            action: "CASE_CHALLENGE",
            message:
              "Kamu telah menyelesaikan modul ini. Hasil asesmen akhir menunjukkan perlunya penguatan penalaran (<80%). Kamu direkomendasikan untuk meninjau kembali argumen CER dan mencoba tantangan kasus lanjutan.",
          };
        }
      }

      // ==========================================
      // Look up paired Pre/Post test and Learning Session Progression
      // ==========================================

      let learningProgression = null;

      try {
        const assignment = await prisma.studentModuleAssignment.findFirst({
          where: {
            studentId,
            moduleId: attempt.assessment.module.id,
          },
          include: {
            learningSession: {
              include: {
                phases: {
                  orderBy: { phaseNumber: "asc" },
                  include: {
                    responses: { orderBy: { createdAt: "asc" } },
                    submission: true,
                  },
                },
              },
            },
          },
        });

        // Find paired attempts
        const allAttempts = await prisma.assessmentAttempt.findMany({
          where: {
            studentId,
            assessment: {
              moduleId: attempt.assessment.module.id,
            },
            status: { in: ["PENDING_GRADING", "GRADED"] },
          },
          include: {
            assessment: {
              select: { type: true },
            },
            answers: {
              include: { question: true },
            },
          },
        });

        const preAttempt = allAttempts.find(
          (a) => a.assessment.type === "PRE_TEST"
        );
        const postAttempt = allAttempts.find(
          (a) => a.assessment.type === "POST_TEST"
        );

        const computeAttemptSummary = (att: typeof preAttempt) => {
          if (!att) return null;
          const mcq = att.answers.filter((a) => a.question.type === "MCQ");
          const ess = att.answers.filter((a) => a.question.type === "ESSAY");
          const mcqEarned = mcq.reduce((s, a) => s + (a.score ?? 0), 0);
          const mcqMax = mcq.reduce((s, a) => s + a.question.maxScore, 0);
          const essEarned = ess.reduce((s, a) => s + (a.score ?? 0), 0);
          const essMax = ess.reduce((s, a) => s + a.question.maxScore, 0);
          const totEarned = mcqEarned + essEarned;
          const totMax = mcqMax + essMax;
          return {
            attemptId: att.id,
            totalScore: Math.round(totEarned * 100) / 100,
            maxScore: totMax,
            percentage: totMax > 0 ? Math.round((totEarned / totMax) * 10000) / 100 : 0,
            mcqScore: mcqEarned,
            mcqMaxScore: mcqMax,
            mcqPercentage: mcqMax > 0 ? Math.round((mcqEarned / mcqMax) * 10000) / 100 : 0,
            essayScore: essEarned,
            essayMaxScore: essMax,
            essayPercentage: essMax > 0 ? Math.round((essEarned / essMax) * 10000) / 100 : 0,
          };
        };

        const preSummary = computeAttemptSummary(preAttempt);
        const postSummary = computeAttemptSummary(postAttempt);

        // Check if learning session phases are completed
        const session = assignment?.learningSession;
        let phaseEvaluation = null;

        if (session && session.phases.length === 5) {
          const p1 = session.phases.find((p) => p.phaseNumber === 1);
          const p2 = session.phases.find((p) => p.phaseNumber === 2);
          const p3 = session.phases.find((p) => p.phaseNumber === 3);
          const p4 = session.phases.find((p) => p.phaseNumber === 4);
          const p5 = session.phases.find((p) => p.phaseNumber === 5);

          const p1Content = p1?.submission?.content as Record<string, unknown> | null;
          const p4Content = p4?.submission?.content as Record<string, unknown> | null;
          const p5Content = p5?.submission?.content as Record<string, unknown> | null;

          // Check if previously evaluated
          if (
            p5Content &&
            typeof p5Content === "object" &&
            "aiEvaluation" in p5Content
          ) {
            phaseEvaluation = p5Content.aiEvaluation as any;
          } else if (p5?.status === "COMPLETED" || session.status === "COMPLETED") {
            phaseEvaluation = await AIEvaluationService.evaluateLearningPhases({
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

            // Persist evaluation
            if (p5?.submission) {
              await prisma.learningPhaseSubmission.update({
                where: { id: p5.submission.id },
                data: {
                  content: {
                    ...(p5Content || {}),
                    aiEvaluation: phaseEvaluation as any,
                  },
                },
              });
            }
          }
        }

        if (preSummary && postSummary && phaseEvaluation) {
          const progression = AIEvaluationService.calculateProgression({
            prePercentage: preSummary.percentage,
            postPercentage: postSummary.percentage,
            phaseScore: phaseEvaluation.phaseScore,
          });

          learningProgression = {
            preTest: preSummary,
            postTest: postSummary,
            phaseEvaluation,
            scoreDifference: progression.scoreDifference,
            normalizedGain: progression.normalizedGain,
            progressionIndex: progression.progressionIndex,
            progressionLevel: progression.progressionLevel,
            progressionLevelLabel: progression.progressionLevelLabel,
            progressionNarrative: progression.progressionNarrative,
          };
        }
      } catch (progressionError) {
        console.warn("Could not compute full learning progression:", progressionError);
      }

      res.status(200).json({
        success: true,
        message: "Assessment results retrieved successfully",
        data: {
          attempt: {
            id: attempt.id,
            status: attempt.status,
            startedAt: attempt.startedAt,
            submittedAt: attempt.submittedAt,
            gradedAt: attempt.gradedAt,
          },

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

          result: {
            totalQuestions: questions.length,
            totalScore,
            maxScore,
            percentage,
            mcqScore: mcqTotalScore,
            mcqMaxScore,
            mcqPercentage,
            essayScore: essayTotalScore,
            essayMaxScore,
            essayPercentage,
            isFullyGraded: true,
            recommendation,
          },

          questions,
          learningProgression,
        },
      });
    } catch (error) {
      console.error("Failed to retrieve assessment results:", error);

      res.status(500).json({
        success: false,
        message: "Failed to retrieve assessment results",
      });
    }
  }
);

// ==========================================
// GET /api/student/learning-results/latest
// Retrieve comprehensive aggregated results of the student's latest module
// ==========================================

router.get(
  "/learning-results/latest",
  requireAuth,
  requireRole("STUDENT"),
  async (_req, res) => {
    const studentId: string | undefined = res.locals.user?.id;

    if (!studentId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    try {
      const assignment = await prisma.studentModuleAssignment.findFirst({
        where: { studentId },
        orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
        include: {
          module: {
            include: {
              case: true,
              assessmentQuestions: {
                orderBy: { order: "asc" },
              },
            },
          },
          learningSession: {
            include: {
              phases: {
                orderBy: { phaseNumber: "asc" },
                include: {
                  responses: { orderBy: { createdAt: "asc" } },
                  submission: true,
                },
              },
            },
          },
        },
      });

      if (!assignment) {
        res.status(404).json({
          success: false,
          message: "No learning module assignment found",
        });
        return;
      }

      const attempts = await prisma.assessmentAttempt.findMany({
        where: {
          studentId,
          assessment: { moduleId: assignment.moduleId },
        },
        include: {
          assessment: { select: { type: true, title: true } },
          answers: {
            include: { question: true },
          },
        },
      });

      const preAttempt = attempts.find(
        (a) => a.assessment.type === "PRE_TEST"
      );
      const postAttempt = attempts.find(
        (a) => a.assessment.type === "POST_TEST"
      );

      const caseData = assignment.module.case;
      const caseContext = {
        title: caseData?.title || assignment.module.title,
        context: caseData?.context || assignment.context,
        topic: caseData?.topic || assignment.module.topic,
        stimulus: caseData?.stimulus || "",
        scientificData: caseData?.scientificData,
        targetConcept: caseData?.targetConcept,
        expertAnswer: caseData?.expertAnswer,
      };

      // Helper to compute / grade an attempt
      const processAttempt = async (att: typeof preAttempt) => {
        if (!att) return null;

        for (const ans of att.answers) {
          if (ans.question.type === "ESSAY" && ans.score === null) {
            const graded = await AIEvaluationService.gradeEssayAnswer({
              questionText: ans.question.questionText,
              rubric: ans.question.rubric,
              maxScore: ans.question.maxScore,
              indicator: ans.question.indicator,
              studentAnswer: ans.answer,
              caseStudy: caseContext,
            });

            await prisma.assessmentAnswer.update({
              where: { id: ans.id },
              data: {
                score: graded.score,
                feedback: graded.feedback,
                gradedAt: new Date(),
              },
            });
            ans.score = graded.score;
            ans.feedback = graded.feedback;
          }
        }

        const mcq = att.answers.filter((a) => a.question.type === "MCQ");
        const ess = att.answers.filter((a) => a.question.type === "ESSAY");
        const mcqEarned = mcq.reduce((s, a) => s + (a.score ?? 0), 0);
        const mcqMax = mcq.reduce((s, a) => s + a.question.maxScore, 0);
        const essEarned = ess.reduce((s, a) => s + (a.score ?? 0), 0);
        const essMax = ess.reduce((s, a) => s + a.question.maxScore, 0);
        const totEarned = mcqEarned + essEarned;
        const totMax = mcqMax + essMax;

        return {
          id: att.id,
          type: att.assessment.type,
          title: att.assessment.title,
          status: att.status,
          submittedAt: att.submittedAt,
          gradedAt: att.gradedAt,
          totalScore: Math.round(totEarned * 100) / 100,
          maxScore: totMax,
          percentage: totMax > 0 ? Math.round((totEarned / totMax) * 10000) / 100 : 0,
          mcqScore: mcqEarned,
          mcqMaxScore: mcqMax,
          mcqPercentage: mcqMax > 0 ? Math.round((mcqEarned / mcqMax) * 10000) / 100 : 0,
          essayScore: essEarned,
          essayMaxScore: essMax,
          essayPercentage: essMax > 0 ? Math.round((essEarned / essMax) * 10000) / 100 : 0,
          questions: att.answers.map((a) => ({
            id: a.question.id,
            type: a.question.type,
            questionText: a.question.questionText,
            maxScore: a.question.maxScore,
            rubric: a.question.rubric,
            indicator: a.question.indicator,
            studentAnswer: {
              answer: a.answer,
              score: a.score,
              feedback: a.feedback,
              isCorrect:
                a.question.type === "MCQ"
                  ? a.answer === a.question.correctAnswer
                  : null,
            },
          })),
        };
      };

      const preProcessed = await processAttempt(preAttempt);
      const postProcessed = await processAttempt(postAttempt);

      // Phase evaluation
      let phaseEvaluation = null;
      const session = assignment.learningSession;

      if (session && session.phases.length === 5) {
        const p1 = session.phases.find((p) => p.phaseNumber === 1);
        const p2 = session.phases.find((p) => p.phaseNumber === 2);
        const p3 = session.phases.find((p) => p.phaseNumber === 3);
        const p4 = session.phases.find((p) => p.phaseNumber === 4);
        const p5 = session.phases.find((p) => p.phaseNumber === 5);

        const p1Content = p1?.submission?.content as Record<string, unknown> | null;
        const p4Content = p4?.submission?.content as Record<string, unknown> | null;
        const p5Content = p5?.submission?.content as Record<string, unknown> | null;

        if (
          p5Content &&
          typeof p5Content === "object" &&
          "aiEvaluation" in p5Content
        ) {
          phaseEvaluation = p5Content.aiEvaluation as any;
        } else {
          phaseEvaluation = await AIEvaluationService.evaluateLearningPhases({
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

          if (p5?.submission) {
            await prisma.learningPhaseSubmission.update({
              where: { id: p5.submission.id },
              data: {
                content: {
                  ...(p5Content || {}),
                  aiEvaluation: phaseEvaluation as any,
                },
              },
            });
          }
        }
      }

      let progression = null;
      if (preProcessed && postProcessed && phaseEvaluation) {
        progression = AIEvaluationService.calculateProgression({
          prePercentage: preProcessed.percentage,
          postPercentage: postProcessed.percentage,
          phaseScore: phaseEvaluation.phaseScore,
        });
      }

      res.status(200).json({
        success: true,
        message: "Module learning results retrieved successfully",
        data: {
          module: {
            id: assignment.module.id,
            title: assignment.module.title,
            topic: assignment.module.topic,
            context: assignment.context,
          },
          status: assignment.status,
          stage: assignment.stage,
          completedAt: assignment.completedAt,
          preTest: preProcessed,
          postTest: postProcessed,
          phaseEvaluation,
          progression,
        },
      });
    } catch (error) {
      console.error("Failed to retrieve latest learning results:", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve latest learning results",
      });
    }
  }
);

export default router;
