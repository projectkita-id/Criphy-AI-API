import { Router } from "express";
import { Prisma } from "../generated/prisma/client";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { moduleIdSchema } from "../validators/module.validator";
import {
  createAssessmentQuestionSchema,
  updateAssessmentQuestionSchema,
} from "../validators/assessment-question.validator";

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

 // ==========================================
 // PATCH /api/modules/:moduleId/questions/:questionId
 // Update a shared assessment question (ADMIN only)
 // ==========================================

 router.patch(
   "/:moduleId/questions/:questionId",
   requireAuth,
   requireRole("ADMIN"),
   async (req, res) => {
     const parsedModuleId = moduleIdSchema.safeParse(
       req.params.moduleId
     );

     const parsedQuestionId = moduleIdSchema.safeParse(
       req.params.questionId
     );

     if (!parsedModuleId.success || !parsedQuestionId.success) {
       res.status(400).json({
         success: false,
         message: "Invalid module ID or question ID",
       });
       return;
     }

     const parsedBody =
       updateAssessmentQuestionSchema.safeParse(req.body);

     if (!parsedBody.success) {
       res.status(400).json({
         success: false,
         message: "Invalid assessment question data",
         errors: parsedBody.error.flatten(),
       });
       return;
     }

     const moduleId = parsedModuleId.data;
     const questionId = parsedQuestionId.data;
     const data = parsedBody.data;

     try {
       const updatedQuestion = await prisma.$transaction(
         async (tx) => {
           // Lock the parent module row to coordinate with
           // question creation, editing, and deletion.
           const lockedModules = await tx.$queryRaw<
             { id: string }[]
           >`
             SELECT id FROM "LearningModule"
             WHERE id = ${moduleId}::uuid
             FOR UPDATE
           `;

           if (lockedModules.length === 0) {
             throw new Error("MODULE_NOT_FOUND");
           }

           // Confirm that the question belongs to this module.
           const existingQuestion =
             await tx.assessmentQuestion.findFirst({
               where: {
                 id: questionId,
                 moduleId,
               },
               select: {
                 id: true,
                 type: true,
               },
             });

           if (!existingQuestion) {
             throw new Error("QUESTION_NOT_FOUND");
           }

           // Question types cannot be changed after creation.
           if (existingQuestion.type !== data.type) {
             throw new Error("QUESTION_TYPE_MISMATCH");
           }

           // Do not modify shared questions after an
           // assessment has been published or attempted.
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

           return tx.assessmentQuestion.update({
             where: { id: questionId },
             data: {
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

       res.status(200).json({
         success: true,
         message: "Assessment question updated successfully",
         data: updatedQuestion,
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
         error.message === "QUESTION_NOT_FOUND"
       ) {
         res.status(404).json({
           success: false,
           message: "Assessment question not found in this module",
         });
         return;
       }

       if (
         error instanceof Error &&
         error.message === "QUESTION_TYPE_MISMATCH"
       ) {
         res.status(400).json({
           success: false,
           message: "Question type cannot be changed",
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
             "Questions cannot be edited after assessment publication or student attempts",
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

       console.error("Failed to update assessment question:", error);

       res.status(500).json({
         success: false,
         message: "Failed to update assessment question",
       });
     }
   }
 );

 // ==========================================
 // DELETE /api/modules/:moduleId/questions/:questionId
 // Delete a shared assessment question (ADMIN only)
 // ==========================================

 router.delete(
   "/:moduleId/questions/:questionId",
   requireAuth,
   requireRole("ADMIN"),
   async (req, res) => {
     const parsedModuleId = moduleIdSchema.safeParse(
       req.params.moduleId
     );

     const parsedQuestionId = moduleIdSchema.safeParse(
       req.params.questionId
     );

     if (!parsedModuleId.success || !parsedQuestionId.success) {
       res.status(400).json({
         success: false,
         message: "Invalid module ID or question ID",
       });
       return;
     }

     const moduleId = parsedModuleId.data;
     const questionId = parsedQuestionId.data;

     try {
       const deletedQuestion = await prisma.$transaction(
         async (tx) => {
           // Coordinate with other question operations
           // by locking the parent module.
           const lockedModules = await tx.$queryRaw<
             { id: string }[]
           >`
             SELECT id FROM "LearningModule"
             WHERE id = ${moduleId}::uuid
             FOR UPDATE
           `;

           if (lockedModules.length === 0) {
             throw new Error("MODULE_NOT_FOUND");
           }

           const question =
             await tx.assessmentQuestion.findFirst({
               where: {
                 id: questionId,
                 moduleId,
               },
               select: {
                 id: true,
                 type: true,
                 order: true,
               },
             });

           if (!question) {
             throw new Error("QUESTION_NOT_FOUND");
           }

           // Prevent deletion if either assessment is
           // published, archived, or has student attempts.
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

           // Explicitly protect existing student answers.
           const existingAnswer =
             await tx.assessmentAnswer.findFirst({
               where: { questionId },
               select: { id: true },
             });

           if (existingAnswer) {
             throw new Error("QUESTION_HAS_ANSWERS");
           }

           return tx.assessmentQuestion.delete({
             where: { id: questionId },
             select: {
               id: true,
               type: true,
               order: true,
               questionText: true,
             },
           });
         }
       );

       res.status(200).json({
         success: true,
         message: "Assessment question deleted successfully",
         data: deletedQuestion,
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
         error.message === "QUESTION_NOT_FOUND"
       ) {
         res.status(404).json({
           success: false,
           message: "Assessment question not found in this module",
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
             "Questions cannot be deleted after assessment publication or student attempts",
         });
         return;
       }

       if (
         error instanceof Error &&
         error.message === "QUESTION_HAS_ANSWERS"
       ) {
         res.status(409).json({
           success: false,
           message: "Question has student answers and cannot be deleted",
         });
         return;
       }

       if (
         error instanceof Prisma.PrismaClientKnownRequestError &&
         error.code === "P2003"
       ) {
         res.status(409).json({
           success: false,
           message: "Question is referenced by existing records",
         });
         return;
       }

       console.error("Failed to delete assessment question:", error);

       res.status(500).json({
         success: false,
         message: "Failed to delete assessment question",
       });
     }
   }
 );

export default router;