import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { provisionFirstAvailableModule } from "../services/module-provisioning.service";
import { learningContextSchema, readLearningContext } from "../utils/learning-context";

const router = Router();

const selectContextSchema = z.object({
  context: learningContextSchema,
}).strict();

const assignmentInclude = {
  module: {
    select: {
      id: true,
      title: true,
      topic: true,
    },
  },
} as const;

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
        message: "Konteks pembelajaran tidak valid.",
      });
      return;
    }

    const { context } = parsed.data;
    const studentId = res.locals.user.id;

    try {
      // Multiple contexts may be active at once, but only one module
      // per context. Picking an active context resumes it.
      const findActiveInContext = (db: Pick<typeof prisma, "studentModuleAssignment">) =>
        db.studentModuleAssignment.findFirst({
          where: {
            studentId,
            context,
            status: "ACTIVE",
          },
          include: assignmentInclude,
        });

      const existing = await findActiveInContext(prisma);

      if (existing) {
        res.status(200).json({
          success: true,
          message: "Melanjutkan modul aktif pada konteks ini",
          data: { ...existing, resumed: true },
        });
        return;
      }

      // Find published modules in the selected context
      // that the student has not been assigned before
      const findEligibleModule = (db: Pick<typeof prisma, "learningModule"> = prisma) => db.learningModule.findFirst({
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
        },
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ],
      });

      // No ready module yet: build one from a published case
      // (AI-generated pre/post-test) instead of failing.
      // Done outside the transaction because AI generation is slow.
      if (!(await findEligibleModule())) {
        await provisionFirstAvailableModule(context, studentId);
      }

      const result = await prisma.$transaction(async (tx) => {
        // Serialize concurrent requests for the same student + context.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assign:${studentId}:${context}`}))`;

        const raced = await findActiveInContext(tx);
        if (raced) return { assignment: raced, created: false };

        const eligibleModule = await findEligibleModule(tx);
        if (!eligibleModule) return null;

        const assignment = await tx.studentModuleAssignment.create({
          data: {
            studentId,
            moduleId: eligibleModule.id,
            context,
            status: "ACTIVE",
            stage: "PRE_TEST",
          },
          include: assignmentInclude,
        });

        return { assignment, created: true };
      });

      if (!result) {
        res.status(404).json({
          success: false,
          message:
            "Belum ada modul pembelajaran untuk konteks ini. Coba konteks lain atau hubungi guru/admin.",
        });
        return;
      }

      res.status(result.created ? 201 : 200).json({
        success: true,
        message: result.created
          ? "Modul pembelajaran berhasil ditetapkan"
          : "Melanjutkan modul aktif pada konteks ini",
        data: { ...result.assignment, resumed: !result.created },
      });
    } catch (error) {
      console.error(
        "Failed to assign learning module:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Gagal menyiapkan modul pembelajaran. Coba lagi beberapa saat lagi.",
      });
    }
  }
);

// GET /api/student/module-assignments/active-list
// All active modules (one per context) for reminders in the UI
router.get(
  "/module-assignments/active-list",
  requireAuth,
  requireRole("STUDENT"),
  async (_req, res) => {
    const studentId = res.locals.user.id;

    try {
      const assignments = await prisma.studentModuleAssignment.findMany({
        where: {
          studentId,
          status: "ACTIVE",
        },
        orderBy: {
          assignedAt: "desc",
        },
        select: {
          id: true,
          context: true,
          stage: true,
          assignedAt: true,
          module: {
            select: {
              id: true,
              title: true,
              topic: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "Active module assignments retrieved successfully",
        data: assignments,
      });
    } catch (error) {
      console.error("Failed to list active module assignments:", error);

      res.status(500).json({
        success: false,
        message: "Gagal memuat daftar modul aktif.",
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
  async (req, res) => {
    const studentId = res.locals.user.id;
    const context = readLearningContext(req.query.context);

    try {
      const assignment =
        await prisma.studentModuleAssignment.findFirst({
          where: {
            studentId,
            status: "ACTIVE",
            ...(context ? { context } : {}),
          },
          orderBy: {
            assignedAt: "desc",
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