import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { Prisma } from "../generated/prisma/client";
import {
  createCaseSchema,
  updateCaseSchema,
  listCasesSchema,
} from "../validators/case.validator";

const router = Router();
router.get(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsed = listCasesSchema.safeParse(req.query);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid pagination parameters",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      res.status(400).json({
        success: false,
        message: "Pagination offset is too large",
      });
      return;
    }

    try {
      const [cases, total] = await prisma.$transaction([
        prisma.validatedCase.findMany({
          skip,
          take: limit,
          select: {
            id: true,
            title: true,
            context: true,
            topic: true,
            version: true,
            validationStatus: true,
            validatedAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
        }),
        prisma.validatedCase.count(),
      ]);

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        message: "Case studies retrieved successfully",
        data: cases,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Failed to retrieve case studies:", error);

      res.status(500).json({
        success: false,
        message: "Failed to retrieve case studies",
      });
    }
  }
);

router.post(
  "/",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsed = createCaseSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study data",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const {
      title,
      context,
      topic,
      stimulus,
      scientificData,
      targetConcept,
      possibleMisconceptions,
      expertAnswer,
    } = parsed.data;

    try {
      const createdCase = await prisma.validatedCase.create({
        data: {
          title,
          context,
          topic,
          stimulus,
            scientificData:
            scientificData === null
                ? Prisma.JsonNull
                : scientificData === undefined
                ? undefined
                : (scientificData as Prisma.InputJsonObject),
          targetConcept,
          possibleMisconceptions:
            possibleMisconceptions ?? undefined,
          expertAnswer,

          // Server-controlled values
          version: 1,
          validationStatus: "DRAFT",
        },
        select: {
          id: true,
          title: true,
          context: true,
          topic: true,
          version: true,
          validationStatus: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "Draft case study created successfully",
        data: createdCase,
      });
    } catch (error) {
      console.error("Case creation failed:", error);

      res.status(500).json({
        success: false,
        message: "Failed to create case study",
      });
    }
  }
);

router.get(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    try {
      const caseStudy = await prisma.validatedCase.findUnique({
        where: { id },
        include: {
          validator: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!caseStudy) {
        res.status(404).json({
          success: false,
          message: "Case study not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Case study retrieved successfully",
        data: caseStudy,
      });
    } catch (error) {
      console.error("Failed to retrieve case study:", error);

      res.status(500).json({
        success: false,
        message: "Failed to retrieve case study",
      });
    }
  }
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const parsed = updateCaseSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study data",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const {
      scientificData,
      possibleMisconceptions,
      ...otherFields
    } = parsed.data;

    try {
      const result = await prisma.validatedCase.updateMany({
        where: {
          id,
          validationStatus: "DRAFT",
        },
        data: {
          ...otherFields,
          ...(scientificData !== undefined && {
            scientificData:
              scientificData === null
                ? Prisma.JsonNull
                : (scientificData as Prisma.InputJsonObject),
          }),
          ...(possibleMisconceptions !== undefined && {
            possibleMisconceptions:
              possibleMisconceptions === null
                ? Prisma.JsonNull
                : possibleMisconceptions,
          }),
        },
      });

      if (result.count === 0) {
        const existingCase = await prisma.validatedCase.findUnique({
          where: { id },
          select: { id: true, validationStatus: true },
        });

        if (!existingCase) {
          res.status(404).json({
            success: false,
            message: "Case study not found",
          });
          return;
        }

        res.status(409).json({
          success: false,
          message: "Only draft case studies can be edited",
        });
        return;
      }

      const updatedCase = await prisma.validatedCase.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          context: true,
          topic: true,
          version: true,
          validationStatus: true,
          updatedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: "Draft case study updated successfully",
        data: updatedCase,
      });
    } catch (error) {
      console.error("Failed to update case study:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update case study",
      });
    }
  }
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const { id } = req.params;

    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    try {
      const result = await prisma.validatedCase.deleteMany({
        where: {
          id,
          validationStatus: "DRAFT",
        },
      });

      if (result.count === 0) {
        const existingCase = await prisma.validatedCase.findUnique({
          where: { id },
          select: {
            id: true,
            validationStatus: true,
          },
        });

        if (!existingCase) {
          res.status(404).json({
            success: false,
            message: "Case study not found",
          });
          return;
        }

        res.status(409).json({
          success: false,
          message: "Only draft case studies can be deleted",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Draft case study deleted successfully",
      });
    } catch (error) {
      console.error("Failed to delete case study:", error);

      res.status(500).json({
        success: false,
        message: "Failed to delete case study",
      });
    }
  }
);

export default router;