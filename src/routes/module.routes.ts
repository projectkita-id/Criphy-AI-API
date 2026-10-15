
import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";


import {
  createModuleSchema,
  updateModuleSchema,
  moduleIdSchema,
} from "../validators/module.validator";

const router = Router();

// POST /api/modules
// Create a new draft learning module (ADMIN only)
router.post(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsed = createModuleSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid learning module data",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const {
      title,
      description,
      topic,
      version,
      gradeLevel,
      learningObjectives,
      targetConcepts,
      caseId,
    } = parsed.data;

    try {
      // Check whether the referenced case exists.
      const caseStudy = await prisma.validatedCase.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          validationStatus: true,
        },
      });

      if (!caseStudy) {
        res.status(404).json({
          success: false,
          message: "Referenced case study not found",
        });
        return;
      }

      // Draft modules can reference cases under review.
      // Publishing will require a VALIDATED case.
      const module = await prisma.learningModule.create({
        data: {
          title,
          description,
          topic,
          version,
          gradeLevel,
          learningObjectives,
          targetConcepts,
          caseId,
          status: "DRAFT",
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
          caseId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "Learning module created successfully",
        data: module,
      });
    } catch (error) {
      console.error(
        "Failed to create learning module:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to create learning module",
      });
    }
  }
);

// GET /api/modules
// List all learning modules (ADMIN only)
router.get(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    try {
      const modules = await prisma.learningModule.findMany({
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          version: true,
          gradeLevel: true,
          learningObjectives: true,
          targetConcepts: true,
          status: true,
          caseId: true,
          createdAt: true,
          updatedAt: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
              version: true,
              validationStatus: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      res.status(200).json({
        success: true,
        message: "Learning modules retrieved successfully",
        data: modules,
      });
    } catch (error) {
      console.error(
        "Failed to retrieve learning modules:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve learning modules",
      });
    }
  }
);

// GET /api/modules/:id
// Retrieve a single learning module (ADMIN only)
router.get(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
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
      const module = await prisma.learningModule.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          version: true,
          gradeLevel: true,
          learningObjectives: true,
          targetConcepts: true,
          status: true,
          caseId: true,
          createdAt: true,
          updatedAt: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
              version: true,
              validationStatus: true,
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
        "Failed to retrieve learning module:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve learning module",
      });
    }
  }
);

// PATCH /api/modules/:id
// Update a draft learning module (ADMIN only)
router.patch(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
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

    const parsed = updateModuleSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid learning module data",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const data = parsed.data;

    try {
      // Verify the referenced case if caseId is being changed.
      if (data.caseId !== undefined) {
        const caseStudy = await prisma.validatedCase.findUnique({
          where: { id: data.caseId },
          select: { id: true },
        });

        if (!caseStudy) {
          res.status(404).json({
            success: false,
            message: "Referenced case study not found",
          });
          return;
        }
      }

      // Only update if the module is still a draft.
      const result = await prisma.learningModule.updateMany({
        where: {
          id,
          status: "DRAFT",
        },
        data,
      });

      if (result.count === 0) {
        const existingModule = await prisma.learningModule.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
          },
        });

        if (!existingModule) {
          res.status(404).json({
            success: false,
            message: "Learning module not found",
          });
          return;
        }

        res.status(409).json({
          success: false,
          message: "Only draft learning modules can be edited",
        });
        return;
      }

      const updatedModule = await prisma.learningModule.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          version: true,
          gradeLevel: true,
          learningObjectives: true,
          targetConcepts: true,
          status: true,
          caseId: true,
          createdAt: true,
          updatedAt: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
              version: true,
              validationStatus: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "Draft learning module updated successfully",
        data: updatedModule,
      });
    } catch (error) {
      console.error(
        "Failed to update learning module:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to update learning module",
      });
    }
  }
);

/**
 * PATCH /api/modules/:id/publish
 * Publish a draft learning module (ADMIN only).
 */
router.patch(
  "/:id/publish",
  requireAuth,
  requireRole("ADMIN"),
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
      const module = await prisma.learningModule.findUnique({
        where: { id },
        include: {
          case: {
            select: {
              id: true,
              title: true,
              validationStatus: true,
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

      if (module.status !== "DRAFT") {
        res.status(409).json({
          success: false,
          message: "Only draft learning modules can be published",
        });
        return;
      }

      if (module.case.validationStatus !== "VALIDATED") {
        res.status(409).json({
          success: false,
          message: "Learning module requires a validated case study",
        });
        return;
      }

      // Validate required module content.
      const missingFields: string[] = [];

      if (!module.gradeLevel.trim()) {
        missingFields.push("gradeLevel");
      }

      if (!module.learningObjectives.trim()) {
        missingFields.push("learningObjectives");
      }

      if (!module.targetConcepts.trim()) {
        missingFields.push("targetConcepts");
      }

      if (missingFields.length > 0) {
        res.status(409).json({
          success: false,
          message: "Learning module is incomplete",
          missingFields,
        });
        return;
      }

      // Prevent publishing if status changed after validation.
      const result = await prisma.learningModule.updateMany({
        where: {
          id,
          status: "DRAFT",
        },
        data: {
          status: "PUBLISHED",
        },
      });

      if (result.count === 0) {
        res.status(409).json({
          success: false,
          message: "Learning module can no longer be published",
        });
        return;
      }

      const publishedModule = await prisma.learningModule.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          version: true,
          gradeLevel: true,
          learningObjectives: true,
          targetConcepts: true,
          status: true,
          caseId: true,
          createdAt: true,
          updatedAt: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
              version: true,
              validationStatus: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "Learning module published successfully",
        data: publishedModule,
      });
    } catch (error) {
      console.error("Failed to publish learning module:", error);

      res.status(500).json({
        success: false,
        message: "Failed to publish learning module",
      });
    }
  }
);

// PATCH /api/modules/:id/archive
// Archive a published learning module (ADMIN only)
router.patch(
  "/:id/archive",
  requireAuth,
  requireRole("ADMIN"),
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
      // Only published modules can be archived.
      const result = await prisma.learningModule.updateMany({
        where: {
          id,
          status: "PUBLISHED",
        },
        data: {
          status: "ARCHIVED",
        },
      });

      if (result.count === 0) {
        const existingModule = await prisma.learningModule.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
          },
        });

        if (!existingModule) {
          res.status(404).json({
            success: false,
            message: "Learning module not found",
          });
          return;
        }

        res.status(409).json({
          success: false,
          message: "Only published learning modules can be archived",
        });
        return;
      }

      const archivedModule = await prisma.learningModule.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          description: true,
          topic: true,
          version: true,
          gradeLevel: true,
          learningObjectives: true,
          targetConcepts: true,
          status: true,
          caseId: true,
          createdAt: true,
          updatedAt: true,
          case: {
            select: {
              id: true,
              title: true,
              context: true,
              topic: true,
              version: true,
              validationStatus: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "Learning module archived successfully",
        data: archivedModule,
      });
    } catch (error) {
      console.error("Failed to archive learning module:", error);

      res.status(500).json({
        success: false,
        message: "Failed to archive learning module",
      });
    }
  }
);

// DELETE /api/modules/:id
// Delete a draft learning module (ADMIN only)
router.delete(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
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
      // Only draft modules may be deleted.
      const result = await prisma.learningModule.deleteMany({
        where: {
          id,
          status: "DRAFT",
        },
      });

      if (result.count === 0) {
        const existingModule = await prisma.learningModule.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
          },
        });

        if (!existingModule) {
          res.status(404).json({
            success: false,
            message: "Learning module not found",
          });
          return;
        }

        res.status(409).json({
          success: false,
          message: "Only draft learning modules can be deleted",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Draft learning module deleted successfully",
        data: {
          id,
        },
      });
    } catch (error) {
      console.error(
        "Failed to delete learning module:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to delete learning module",
      });
    }
  }
);

export default router;