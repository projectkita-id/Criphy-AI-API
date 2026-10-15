
import { Router } from "express";
import { Prisma } from "../generated/prisma/client";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { createAssessmentSchema } from "../validators/assessment.validator";

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

export default router;