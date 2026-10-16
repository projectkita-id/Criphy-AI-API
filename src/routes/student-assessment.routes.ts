import { Router } from "express";
import { Prisma } from "../generated/prisma/client";

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

 // ==========================================
 // POST /api/student/assessments/:assessmentId/attempts
 // Start a pre-test attempt (STUDENT only)
 // ==========================================

 router.post(
   "/assessments/:assessmentId/attempts",
   requireAuth,
   requireRole("STUDENT"),
   async (req, res) => {
     // 1. Validate assessment ID
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

     // 2. Get student identity from authenticated session
     // Adjust this line to match your auth middleware.
     const studentId = res.locals.user?.id;

     if (!studentId) {
       res.status(401).json({
         success: false,
         message: "Authentication required",
       });
       return;
     }

     try {
       // 3. Verify published pre-test and module
       const assessment = await prisma.assessment.findFirst({
         where: {
           id: assessmentId,
           type: "PRE_TEST",
           status: "PUBLISHED",
           module: {
             is: {
               status: "PUBLISHED",
             },
           },
         },
         select: {
           id: true,
         },
       });

       if (!assessment) {
         res.status(404).json({
           success: false,
           message: "Available pre-test not found",
         });
         return;
       }

       // 4. Check whether this student has an attempt
       const existingAttempt =
         await prisma.assessmentAttempt.findUnique({
           where: {
             assessmentId_studentId: {
               assessmentId,
               studentId,
             },
           },
           select: {
             id: true,
           },
         });

       if (existingAttempt) {
         res.status(409).json({
           success: false,
           message:
             "You have already started this assessment",
         });
         return;
       }

       // 5. Create attempt
       const attempt =
         await prisma.assessmentAttempt.create({
           data: {
             assessmentId,
             studentId,
             status: "IN_PROGRESS",
           },
           select: {
             id: true,
             assessmentId: true,
             status: true,
             startedAt: true,
           },
         });

       // 6. Return created attempt
       res.status(201).json({
         success: true,
         message: "Pre-test attempt started successfully",
         data: attempt,
       });
     } catch (error) {
       // Handle simultaneous requests safely.
       // The database unique constraint prevents duplicates.
       if (
         error instanceof Prisma.PrismaClientKnownRequestError &&
         error.code === "P2002"
       ) {
         res.status(409).json({
           success: false,
           message:
             "You have already started this assessment",
         });
         return;
       }

       console.error(
         "Failed to start pre-test attempt:",
         error
       );

       res.status(500).json({
         success: false,
         message: "Failed to start pre-test attempt",
       });
     }
   }
 );

export default router;