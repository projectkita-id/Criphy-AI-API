import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

const selectContextSchema = z.object({
  context: z.enum([
    "DAILY_LIFE",
    "ENVIRONMENT",
    "TECHNOLOGY",
  ]),
}).strict();

// POST /api/student/module-assignments
// Select a context and receive one eligible module
router.post(
  "/module-assignments",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    const parsed = selectContextSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid learning context",
      });
      return;
    }

    const { context } = parsed.data;
    const studentId = res.locals.user.id;

    try {
      // A student may only have one active module
      const activeAssignment =
        await prisma.studentModuleAssignment.findFirst({
          where: {
            studentId,
            status: "ACTIVE",
          },
          include: {
            module: {
              select: {
                id: true,
                title: true,
                topic: true,
              },
            },
          },
        });

      if (activeAssignment) {
        res.status(409).json({
          success: false,
          message:
            "You must complete your current module before requesting another one",
          data: activeAssignment,
        });
        return;
      }

      // Find published modules in the selected context
      // that the student has not been assigned before
      const eligibleModule = await prisma.learningModule.findFirst({
        where: {
          status: "PUBLISHED",
          case: {
            context,
            validationStatus: "VALIDATED",
          },
          studentAssignments: {
            none: {
              studentId,
            },
          },
          assessments: {
            some: {
              type: "PRE_TEST",
              status: "PUBLISHED",
            },
          },
          AND: [
            {
              assessments: {
                some: {
                  type: "POST_TEST",
                  status: "PUBLISHED",
                },
              },
            },
          ],
        },
        select: {
          id: true,
          title: true,
          topic: true,
        },
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ],
      });

      if (!eligibleModule) {
        res.status(404).json({
          success: false,
          message:
            "No eligible learning modules are available for this context",
        });
        return;
      }

      // Database unique indexes prevent duplicate
      // or simultaneous active assignments
      const assignment =
        await prisma.studentModuleAssignment.create({
          data: {
            studentId,
            moduleId: eligibleModule.id,
            context,
            status: "ACTIVE",
            stage: "PRE_TEST",
          },
          include: {
            module: {
              select: {
                id: true,
                title: true,
                topic: true,
              },
            },
          },
        });

      res.status(201).json({
        success: true,
        message: "Learning module assigned successfully",
        data: assignment,
      });
    } catch (error) {
      console.error(
        "Failed to assign learning module:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to assign learning module",
      });
    }
  }
);

// GET /api/student/module-assignments/active
// Retrieve the authenticated student's active module
router.get(
  "/module-assignments/active",
  requireAuth,
  requireRole("STUDENT"),
  async (_req, res) => {
    const studentId = res.locals.user.id;

    try {
      const assignment =
        await prisma.studentModuleAssignment.findFirst({
          where: {
            studentId,
            status: "ACTIVE",
          },
          select: {
            id: true,
            context: true,
            status: true,
            stage: true,
            assignedAt: true,
            completedAt: true,

            module: {
              select: {
                id: true,
                title: true,
                description: true,
                topic: true,
                version: true,
                gradeLevel: true,
                learningObjectives: true,
                targetConcepts: true,

                case: {
                  select: {
                    id: true,
                    title: true,
                    context: true,
                    topic: true,
                  },
                },

                assessments: {
                  where: {
                    status: "PUBLISHED",
                  },
                  select: {
                    id: true,
                    title: true,
                    type: true,
                    status: true,
                  },
                  orderBy: {
                    type: "asc",
                  },
                },
              },
            },
          },
        });

      res.status(200).json({
        success: true,
        message: assignment
          ? "Active module assignment retrieved successfully"
          : "No active module assignment found",
        data: assignment,
      });
    } catch (error) {
      console.error(
        "Failed to retrieve active module assignment:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve active module assignment",
      });
    }
  }
);

export default router;