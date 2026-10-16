import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

import { attemptIdSchema } from "../validators/assessment-answer.validator";

const router = Router();

// ==========================================
// GET /api/student/attempts/:attemptId/results
// Retrieve finalized assessment results
// ==========================================

router.get(
  "/attempts/:attemptId/results",
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
      const attempt =
        await prisma.assessmentAttempt.findFirst({
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
                    assessmentQuestions: {
                      orderBy: {
                        order: "asc",
                      },
                      select: {
                        id: true,
                        type: true,
                        order: true,
                        questionText: true,
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

      if (attempt.status !== "GRADED") {
        res.status(409).json({
          success: false,
          message:
            "Assessment results are not available yet",
        });
        return;
      }

      // ==========================================
      // Match student answers to questions
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
              indicator: question.indicator,
              maxScore: question.maxScore,

              studentAnswer: studentAnswer
                ? {
                    answer: studentAnswer.answer,
                    score: studentAnswer.score,
                    feedback: studentAnswer.feedback,
                  }
                : null,
            };
          }
        );

      // ==========================================
      // Calculate final score
      // ==========================================

      const totalScore = questions.reduce(
        (total, question) =>
          total + (question.studentAnswer?.score ?? 0),
        0
      );

      const maxScore = questions.reduce(
        (total, question) =>
          total + question.maxScore,
        0
      );

      const percentage =
        maxScore > 0
          ? Math.round(
              (totalScore / maxScore) * 10000
            ) / 100
          : 0;

      res.status(200).json({
        success: true,
        message:
          "Assessment results retrieved successfully",
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
          },

          questions,
        },
      });
    } catch (error) {
      console.error(
        "Failed to retrieve assessment results:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to retrieve assessment results",
      });
    }
  }
);

export default router;