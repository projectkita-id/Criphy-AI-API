
import { Router } from "express";
import { Prisma } from "../generated/prisma/client";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import {
  createAssessmentSchema,
  assessmentIdSchema,
} from "../validators/assessment.validator";

const router = Router();

// ==========================================
// POST /api/assessments
// Create a draft assessment (ADMIN only)
// ==========================================

router.post(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsed = createAssessmentSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid assessment data",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const { title, type, moduleId } = parsed.data;

    try {
      // ==========================================
      // 1. Validate learning module
      // ==========================================

      const learningModule = await prisma.learningModule.findUnique({
        where: { id: moduleId },
        select: {
          id: true,
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

      // ==========================================
      // 2. Check existing assessment
      // ==========================================

      const existingAssessment = await prisma.assessment.findUnique({
        where: {
          moduleId_type: {
            moduleId,
            type,
          },
        },
        select: {
          id: true,
        },
      });

      if (existingAssessment) {
        res.status(409).json({
          success: false,
          message: `This module already has a ${type}`,
        });
        return;
      }

      // ==========================================
      // 3. Create draft assessment
      // ==========================================

      const assessment = await prisma.assessment.create({
        data: {
          title,
          type,
          moduleId,
          status: "DRAFT",
        },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          moduleId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "Draft assessment created successfully",
        data: assessment,
      });
    } catch (error) {
      // ==========================================
      // 4. Handle duplicate assessment
      // ==========================================

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          success: false,
          message: `This module already has a ${type}`,
        });
        return;
      }

      // ==========================================
      // 5. Handle unexpected errors
      // ==========================================

      console.error("Failed to create assessment:", error);

      res.status(500).json({
        success: false,
        message: "Failed to create assessment",
      });
    }
  }
);
 // ==========================================
 // PATCH /api/assessments/:assessmentId/publish
 // Publish a draft assessment (ADMIN only)
 // ==========================================

 router.patch(
   "/:assessmentId/publish",
   requireAuth,
   requireRole("ADMIN"),
   async (req, res) => {
     const parsedId = assessmentIdSchema.safeParse(
       req.params.assessmentId
     );

     if (!parsedId.success) {
       res.status(400).json({
         success: false,
         message: "Invalid assessment ID",
       });
       return;
     }

     const assessmentId = parsedId.data;

     try {
       const publishedAssessment = await prisma.$transaction(
         async (tx) => {
           // Locate the assessment and its module.
           const initialAssessment =
             await tx.assessment.findUnique({
               where: { id: assessmentId },
               select: {
                 id: true,
                 moduleId: true,
               },
             });

           if (!initialAssessment) {
             throw new Error("ASSESSMENT_NOT_FOUND");
           }

           const moduleId = initialAssessment.moduleId;

           // Lock the parent module to coordinate with
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

           // Re-read assessment after obtaining the lock.
           const assessment =
             await tx.assessment.findUnique({
               where: { id: assessmentId },
               select: {
                 id: true,
                 type: true,
                 status: true,
                 moduleId: true,
                 module: {
                   select: {
                     id: true,
                     status: true,
                   },
                 },
               },
             });

           if (!assessment) {
             throw new Error("ASSESSMENT_NOT_FOUND");
           }

           if (assessment.status !== "DRAFT") {
             throw new Error("ASSESSMENT_NOT_DRAFT");
           }

           if (assessment.module.status !== "PUBLISHED") {
             throw new Error("MODULE_NOT_PUBLISHED");
           }

           // Retrieve all shared questions.
           const questions =
             await tx.assessmentQuestion.findMany({
               where: { moduleId },
               orderBy: { order: "asc" },
               select: {
                 type: true,
                 options: true,
                 correctAnswer: true,
                 rubric: true,
                 maxScore: true,
               },
             });

           if (questions.length === 0) {
             throw new Error("NO_QUESTIONS");
           }

           // Validate every question before publication.
           for (const question of questions) {
             if (
               !Number.isFinite(question.maxScore) ||
               question.maxScore <= 0
             ) {
               throw new Error("INVALID_QUESTION");
             }

             if (question.type === "MCQ") {
               if (
                 !Array.isArray(question.options) ||
                 question.options.length < 2 ||
                 !question.correctAnswer
               ) {
                 throw new Error("INVALID_QUESTION");
               }

               const keys: string[] = [];

               for (const option of question.options) {
                 if (
                   typeof option !== "object" ||
                   option === null ||
                   Array.isArray(option) ||
                   typeof option.key !== "string" ||
                   typeof option.text !== "string" ||
                   !option.key.trim() ||
                   !option.text.trim()
                 ) {
                   throw new Error("INVALID_QUESTION");
                 }

                 keys.push(option.key);
               }

               if (
                 new Set(keys).size !== keys.length ||
                 !keys.includes(question.correctAnswer)
               ) {
                 throw new Error("INVALID_QUESTION");
               }
             }

             if (question.type === "ESSAY") {
               if (!question.rubric?.trim()) {
                 throw new Error("INVALID_QUESTION");
               }
             }
           }

           // Publish assessment.
           return tx.assessment.update({
             where: { id: assessmentId },
             data: {
               status: "PUBLISHED",
             },
             select: {
               id: true,
               title: true,
               type: true,
               status: true,
               moduleId: true,
               createdAt: true,
               updatedAt: true,
             },
           });
         }
       );

       res.status(200).json({
         success: true,
         message: "Assessment published successfully",
         data: publishedAssessment,
       });
     } catch (error) {
       const knownErrors: Record<string, {
         status: number;
         message: string;
       }> = {
         ASSESSMENT_NOT_FOUND: {
           status: 404,
           message: "Assessment not found",
         },
         MODULE_NOT_FOUND: {
           status: 404,
           message: "Learning module not found",
         },
         ASSESSMENT_NOT_DRAFT: {
           status: 409,
           message: "Only draft assessments can be published",
         },
         MODULE_NOT_PUBLISHED: {
           status: 409,
           message:
             "Learning module must be published before its assessments",
         },
         NO_QUESTIONS: {
           status: 409,
           message:
             "Assessment cannot be published without questions",
         },
         INVALID_QUESTION: {
           status: 409,
           message:
             "One or more shared questions have invalid grading data",
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

       console.error("Failed to publish assessment:", error);

       res.status(500).json({
         success: false,
         message: "Failed to publish assessment",
       });
     }
   }
 );

export default router;