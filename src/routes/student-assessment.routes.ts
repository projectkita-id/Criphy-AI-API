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
 // Retrieve assigned pre-test or post-test questions
 // ==========================================

 router.get(
   "/assessments/:assessmentId",
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

     try {
       // 3. Find published assessment and module
       const assessment =
         await prisma.assessment.findFirst({
           where: {
             id: parsedId.data,
             status: "PUBLISHED",
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

       // 4. Find student's active assignment
       const assignment =
         await prisma.studentModuleAssignment.findFirst({
           where: {
             studentId,
             status: "ACTIVE",
           },
           select: {
             moduleId: true,
             stage: true,
           },
         });

       if (!assignment) {
         res.status(403).json({
           success: false,
           message:
             "You do not have an active module assignment",
         });
         return;
       }

       // 5. Verify assessment belongs to assigned module
       if (assignment.moduleId !== assessment.moduleId) {
         res.status(403).json({
           success: false,
           message:
             "This assessment does not belong to your assigned learning module",
         });
         return;
       }

       // 6. Enforce assessment stage
       const requiredStage =
         assessment.type === "PRE_TEST"
           ? "PRE_TEST"
           : "POST_TEST";

       if (assignment.stage !== requiredStage) {
         res.status(409).json({
           success: false,
           message:
             `This ${assessment.type.toLowerCase().replace("_", "-")} is not available at your current learning stage`,
         });
         return;
       }

       // 7. Retrieve shared questions
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

       // 8. Return safe assessment data
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
// Start pre-test or post-test attempt
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
      const result = await prisma.$transaction(
        async (tx) => {
          // ==========================================
          // 2. Lock student's active assignment
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
            return {
              error: "NO_ACTIVE_ASSIGNMENT" as const,
            };
          }

          // ==========================================
          // 3. Retrieve active assignment
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
            return {
              error: "NO_ACTIVE_ASSIGNMENT" as const,
            };
          }

          // ==========================================
          // 4. Retrieve published assessment
          // ==========================================

          const assessment =
            await tx.assessment.findFirst({
              where: {
                id: assessmentId,
                status: "PUBLISHED",
                module: {
                  is: {
                    status: "PUBLISHED",
                  },
                },
              },
              select: {
                id: true,
                moduleId: true,
                type: true,
              },
            });

          if (!assessment) {
            return {
              error: "ASSESSMENT_NOT_FOUND" as const,
            };
          }

          // ==========================================
          // 5. Validate module ownership
          // ==========================================

          if (assignment.moduleId !== assessment.moduleId) {
            return {
              error: "WRONG_MODULE" as const,
            };
          }

          // ==========================================
          // 6. Validate learning stage
          // ==========================================

          const requiredStage =
            assessment.type === "PRE_TEST"
              ? "PRE_TEST"
              : "POST_TEST";

          if (assignment.stage !== requiredStage) {
            return {
              error: "INVALID_STAGE" as const,
            };
          }

          // ==========================================
          // 7. Validate post-test prerequisites
          // ==========================================

          if (assessment.type === "POST_TEST") {
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
              return {
                error: "LEARNING_NOT_COMPLETED" as const,
              };
            }
          }

          // ==========================================
          // 8. Prevent duplicate attempts
          // ==========================================

          const existingAttempt =
            await tx.assessmentAttempt.findUnique({
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
            return {
              error: "ALREADY_STARTED" as const,
            };
          }

          // ==========================================
          // 9. Create assessment attempt
          // ==========================================

          const attempt =
            await tx.assessmentAttempt.create({
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

          return {
            created: true as const,
            attempt,
            assessmentType: assessment.type,
          };
        },
        {
          maxWait: 5000,
          timeout: 10000,
        }
      );

      // ==========================================
      // 10. Handle expected errors
      // ==========================================

      if ("error" in result && result.error !== undefined) {
        const errors = {
          NO_ACTIVE_ASSIGNMENT: {
            status: 403,
            message:
              "You must have an active module assignment before starting an assessment",
          },
          ASSESSMENT_NOT_FOUND: {
            status: 404,
            message: "Available assessment not found",
          },
          WRONG_MODULE: {
            status: 403,
            message:
              "This assessment does not belong to your assigned learning module",
          },
          INVALID_STAGE: {
            status: 409,
            message:
              "This assessment is not available at your current learning stage",
          },
          LEARNING_NOT_COMPLETED: {
            status: 409,
            message:
              "You must complete all five learning phases before starting the post-test",
          },
          ALREADY_STARTED: {
            status: 409,
            message:
              "You have already started this assessment",
          },
        };

        const error = errors[result.error];

        res.status(error.status).json({
          success: false,
          message: error.message,
        });
        return;
      }

      // ==========================================
      // 11. Return created attempt
      // ==========================================

      res.status(201).json({
        success: true,
        message:
          result.assessmentType === "PRE_TEST"
            ? "Pre-test attempt started successfully"
            : "Post-test attempt started successfully",
        data: result.attempt,
      });
    } catch (error) {
      // Handle simultaneous duplicate requests
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
        "Failed to start assessment attempt:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to start assessment attempt",
      });
    }
  }
);

export default router;