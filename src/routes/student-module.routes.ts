import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { moduleIdSchema } from "../validators/module.validator";

const router = Router();

// GET /api/student/modules
// List published learning modules (STUDENT only)
router.get(
  "/",
  requireAuth,
  requireRole("STUDENT"),
  async (_req, res) => {
    try {
      const modules = await prisma.learningModule.findMany({
        where: {
          status: "PUBLISHED",
        },
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          version: true,
          gradeLevel: true,
          learningObjectives: true,
          targetConcepts: true,
          createdAt: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
            },
          },
        },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
      });

      res.status(200).json({
        success: true,
        message: "Published learning modules retrieved successfully",
        data: modules,
      });
    } catch (error) {
      console.error(
        "Failed to retrieve student learning modules:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve learning modules",
      });
    }
  }
);

// GET /api/student/modules/:id
// View one published learning module (STUDENT only)
router.get(
  "/:id",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    const parsedId = moduleIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid learning module ID",
      });
      return;
    }

    const id = parsedId.data;

    try {
      const module = await prisma.learningModule.findFirst({
        where: {
          id,
          status: "PUBLISHED",
        },
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          version: true,
          gradeLevel: true,
          learningObjectives: true,
          targetConcepts: true,
          createdAt: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
            },
          },
        },
      });

      if (!module) {
        res.status(404).json({
          success: false,
          message: "Learning module not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Learning module retrieved successfully",
        data: module,
      });
    } catch (error) {
      console.error(
        "Failed to retrieve student learning module:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve learning module",
      });
    }
  }
);

export default router;