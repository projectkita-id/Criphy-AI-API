import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { moduleIdSchema } from "../validators/module.validator";
import { assessmentIdSchema } from "../validators/assessment.validator";

const router = Router();

// ==========================================
// GET /api/student/modules/:moduleId/assessments
// List published assessments (STUDENT only)
// ==========================================

router.get(
  "/modules/:moduleId/assessments",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    // ==========================================
    // 1. Validate module ID
    // ==========================================

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
      // ==========================================
      // 2. Find published learning module
      // ==========================================

      const learningModule =
        await prisma.learningModule.findFirst({
          where: {
            id: moduleId,
            status: "PUBLISHED",
          },
          select: {
            id: true,
            title: true,
            topic: true,
          },
        });

      if (!learningModule) {
        res.status(404).json({
          success: false,
          message: "Published learning module not found",
        });
        return;
      }

      // ==========================================
      // 3. Retrieve published assessments
      // ==========================================

      const assessments =
        await prisma.assessment.findMany({
          where: {
            moduleId,
            status: "PUBLISHED",
          },
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
          },
        });

      // ==========================================
      // 4. Sort PRE_TEST before POST_TEST
      // ==========================================

      const typeOrder = {
        PRE_TEST: 0,
        POST_TEST: 1,
      };

      assessments.sort(
        (a, b) =>
          typeOrder[a.type] - typeOrder[b.type]
      );

      // ==========================================
      // 5. Return safe assessment metadata
      // ==========================================

      res.status(200).json({
        success: true,
        message: "Published assessments retrieved successfully",
        data: {
          module: learningModule,
          total: assessments.length,
          assessments,
        },
      });
    } catch (error) {
      console.error(
        "Failed to retrieve student assessments:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve assessments",
      });
    }
  }
);

 // ==========================================
 // GET /api/student/assessments/:assessmentId
 // Retrieve published pre-test questions (STUDENT only)
 // ==========================================

 router.get(
   "/assessments/:assessmentId",
   requireAuth,
   requireRole("STUDENT"),
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

     try {
       // Find published assessment in a published module.
       const assessment = await prisma.assessment.findFirst({
         where: {
           id: parsedId.data,
           status: "PUBLISHED",
           type: "PRE_TEST",
           module: {
             is: {
               status: "PUBLISHED",
             },
           },
         },
         select: {
           id: true,
           title: true,
           type: true,
           status: true,
           moduleId: true,
           module: {
             select: {
               title: true,
               topic: true,
             },
           },
         },
       });

       if (!assessment) {
         res.status(404).json({
           success: false,
           message: "Available assessment not found",
         });
         return;
       }

       // Shared questions belong to the Learning Module,
       // not directly to the assessment.
       const questions =
         await prisma.assessmentQuestion.findMany({
           where: {
             moduleId: assessment.moduleId,
           },
           orderBy: {
             order: "asc",
           },
           select: {
             id: true,
             type: true,
             questionText: true,
             order: true,
             options: true,
             maxScore: true,
           },
         });

       res.status(200).json({
         success: true,
         message: "Assessment retrieved successfully",
         data: {
           assessment,
           totalQuestions: questions.length,
           questions,
         },
       });
     } catch (error) {
       console.error(
         "Failed to retrieve student assessment:",
         error
       );

       res.status(500).json({
         success: false,
         message: "Failed to retrieve assessment",
       });
     }
   }
 );

export default router;