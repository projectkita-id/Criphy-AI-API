import { Router } from "express";
import { Prisma } from "../generated/prisma/client";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { moduleIdSchema } from "../validators/module.validator";
import { createAssessmentQuestionSchema } from "../validators/assessment-question.validator";

const router = Router();

// POST /api/modules/:moduleId/questions
router.post(
  "/:moduleId/questions",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = moduleIdSchema.safeParse(req.params.moduleId);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid learning module ID",
      });
      return;
    }

    const parsedBody =
      createAssessmentQuestionSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({
        success: false,
        message: "Invalid assessment question data",
        errors: parsedBody.error.flatten(),
      });
      return;
    }

    const moduleId = parsedId.data;
    const data = parsedBody.data;

    try {
      const question = await prisma.$transaction(
        async (tx) => {
          // Serialize question changes for this module.
          await tx.$queryRaw`
            SELECT id FROM "LearningModule"
            WHERE id = ${moduleId}::uuid
            FOR UPDATE
          `;

          const learningModule =
            await tx.learningModule.findUnique({
              where: { id: moduleId },
              select: {
                id: true,
                status: true,
              },
            });

          if (!learningModule) {
            throw new Error("MODULE_NOT_FOUND");
          }

          // Prevent changes once assessments are published
          // or any student attempts exist.
          const lockedAssessment =
            await tx.assessment.findFirst({
              where: {
                moduleId,
                OR: [
                  { status: { not: "DRAFT" } },
                  { attempts: { some: {} } },
                ],
              },
              select: { id: true },
            });

          if (lockedAssessment) {
            throw new Error("QUESTIONS_LOCKED");
          }

          return tx.assessmentQuestion.create({
            data: {
              moduleId,
              type: data.type,
              questionText: data.questionText,
              order: data.order,
              maxScore: data.maxScore,
              indicator: data.indicator ?? null,
              options:
                data.type === "MCQ"
                  ? data.options
                  : Prisma.JsonNull,
              correctAnswer:
                data.type === "MCQ"
                  ? data.correctAnswer
                  : null,
              rubric:
                data.type === "ESSAY"
                  ? data.rubric
                  : null,
            },
            select: {
              id: true,
              moduleId: true,
              type: true,
              questionText: true,
              order: true,
              options: true,
              correctAnswer: true,
              rubric: true,
              maxScore: true,
              indicator: true,
              createdAt: true,
              updatedAt: true,
            },
          });
        }
      );

      res.status(201).json({
        success: true,
        message: "Assessment question created successfully",
        data: question,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "MODULE_NOT_FOUND"
      ) {
        res.status(404).json({
          success: false,
          message: "Learning module not found",
        });
        return;
      }

      if (
        error instanceof Error &&
        error.message === "QUESTIONS_LOCKED"
      ) {
        res.status(409).json({
          success: false,
          message:
            "Questions cannot be changed after assessment publication or student attempts",
        });
        return;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          success: false,
          message: "Question order already exists in this module",
        });
        return;
      }

      console.error("Failed to create assessment question:", error);

      res.status(500).json({
        success: false,
        message: "Failed to create assessment question",
      });
    }
  }
);

 // GET /api/modules/:moduleId/questions
 // List shared assessment questions (ADMIN only)
 router.get(
   "/:moduleId/questions",
   requireAuth,
   requireRole("ADMIN"),
   async (req, res) => {
     const parsedId = moduleIdSchema.safeParse(
       req.params.moduleId
     );

     if (!parsedId.success) {
       res.status(400).json({
         success: false,
         message: "Invalid learning module ID",
       });
       return;
     }

     const moduleId = parsedId.data;

     try {
       const learningModule =
         await prisma.learningModule.findUnique({
           where: { id: moduleId },
           select: {
             id: true,
             title: true,
             status: true,
           },
         });

       if (!learningModule) {
         res.status(404).json({
           success: false,
           message: "Learning module not found",
         });
         return;
       }

       const questions =
         await prisma.assessmentQuestion.findMany({
           where: { moduleId },
           orderBy: { order: "asc" },
           select: {
             id: true,
             moduleId: true,
             type: true,
             questionText: true,
             order: true,
             options: true,
             correctAnswer: true,
             rubric: true,
             maxScore: true,
             indicator: true,
             createdAt: true,
             updatedAt: true,
           },
         });

       res.status(200).json({
         success: true,
         message: "Assessment questions retrieved successfully",
         data: {
           module: learningModule,
           total: questions.length,
           questions,
         },
       });
     } catch (error) {
       console.error(
         "Failed to retrieve assessment questions:",
         error
       );

       res.status(500).json({
         success: false,
         message: "Failed to retrieve assessment questions",
       });
     }
   }
 );

export default router;