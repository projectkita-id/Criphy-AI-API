import { Router } from "express";
import { randomUUID } from "node:crypto";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { Prisma } from "../generated/prisma/client";

import {
  createCaseSchema,
  listCasesSchema,
  updateCaseSchema,
  rejectCaseSchema,
  caseIdSchema,
} from "../validators/case.validator";

const router = Router();

// GET /api/cases
// List all case studies (ADMIN only)
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

// POST /api/cases
// Create a draft case study (ADMIN only)
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

          // Server-controlled versioning
          caseGroupId: randomUUID(),
          version: 1,

          // Server-controlled validation
          validationStatus: "DRAFT",
        },
        select: {
          id: true,
          caseGroupId: true,
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

// GET /api/cases/:id
// Retrieve a single case study (ADMIN only)
router.get(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;

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

// PATCH /api/cases/:id
// Update a draft case study (ADMIN only)
router.patch(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;
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

// DELETE /api/cases/:id
// Delete the latest draft or rejected case version
router.delete(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;

    try {
      const caseStudy = await prisma.validatedCase.findUnique({
        where: { id },
        select: {
          id: true,
          caseGroupId: true,
          version: true,
          validationStatus: true,
        },
      });

      if (!caseStudy) {
        res.status(404).json({
          success: false,
          message: "Case study not found",
        });
        return;
      }

      if (
        caseStudy.validationStatus !== "DRAFT" &&
        caseStudy.validationStatus !== "REJECTED"
      ) {
        res.status(409).json({
          success: false,
          message: "Only draft or rejected case studies can be deleted",
        });
        return;
      }

      const newerVersion = await prisma.validatedCase.findFirst({
        where: {
          caseGroupId: caseStudy.caseGroupId,
          version: {
            gt: caseStudy.version,
          },
        },
        select: {
          id: true,
        },
      });

      if (newerVersion) {
        res.status(409).json({
          success: false,
          message: "Only the latest case study version can be deleted",
        });
        return;
      }

      const result = await prisma.validatedCase.deleteMany({
        where: {
          id,
          validationStatus: {
            in: ["DRAFT", "REJECTED"],
          },
        },
      });

      if (result.count === 0) {
        res.status(409).json({
          success: false,
          message: "Case study can no longer be deleted",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Case study deleted successfully",
        data: {
          id: caseStudy.id,
          caseGroupId: caseStudy.caseGroupId,
          version: caseStudy.version,
        },
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

// PATCH /api/cases/:id/submit
// Submit a draft for expert review
router.patch(
  "/:id/submit",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;

    try {
      const result = await prisma.validatedCase.updateMany({
        where: {
          id,
          validationStatus: "DRAFT",
        },
        data: {
          validationStatus: "IN_REVIEW",
          rejectionReason: null,
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
          message: "Only draft case studies can be submitted for review",
        });
        return;
      }

      const submittedCase = await prisma.validatedCase.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          validationStatus: true,
          updatedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: "Case study submitted for review successfully",
        data: submittedCase,
      });
    } catch (error) {
      console.error("Failed to submit case study:", error);

      res.status(500).json({
        success: false,
        message: "Failed to submit case study for review",
      });
    }
  }
);

// PATCH /api/cases/:id/approve
// Approve a case under review
router.patch(
  "/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;

    const admin = res.locals.user as {
      id: string;
      role: "ADMIN";
    };

    try {
      const result = await prisma.validatedCase.updateMany({
        where: {
          id,
          validationStatus: "IN_REVIEW",
        },
        data: {
          validationStatus: "VALIDATED",
          validatorId: admin.id,
          validatedAt: new Date(),
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
          message: "Only case studies under review can be approved",
        });
        return;
      }

      const approvedCase = await prisma.validatedCase.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          validationStatus: true,
          validatorId: true,
          validatedAt: true,
          updatedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: "Case study approved successfully",
        data: approvedCase,
      });
    } catch (error) {
      console.error("Failed to approve case study:", error);

      res.status(500).json({
        success: false,
        message: "Failed to approve case study",
      });
    }
  }
);

// PATCH /api/cases/:id/reject
// Reject a case under review
router.patch(
  "/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;
    const parsed = rejectCaseSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid rejection data",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const { reason } = parsed.data;

    try {
      const result = await prisma.validatedCase.updateMany({
        where: {
          id,
          validationStatus: "IN_REVIEW",
        },
        data: {
          validationStatus: "REJECTED",
          rejectionReason: reason,
          validatorId: null,
          validatedAt: null,
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
          message: "Only case studies under review can be rejected",
        });
        return;
      }

      const rejectedCase = await prisma.validatedCase.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          validationStatus: true,
          rejectionReason: true,
          updatedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: "Case study rejected successfully",
        data: rejectedCase,
      });
    } catch (error) {
      console.error("Failed to reject case study:", error);

      res.status(500).json({
        success: false,
        message: "Failed to reject case study",
      });
    }
  }
);

// PATCH /api/cases/:id/revise
// Reopen a rejected case as a draft
router.patch(
  "/:id/revise",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;

    try {
      const result = await prisma.validatedCase.updateMany({
        where: {
          id,
          validationStatus: "REJECTED",
        },
        data: {
          validationStatus: "DRAFT",
          validatorId: null,
          validatedAt: null,
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
          message: "Only rejected case studies can be reopened for revision",
        });
        return;
      }

      const revisedCase = await prisma.validatedCase.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          validationStatus: true,
          rejectionReason: true,
          updatedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: "Case study reopened for revision successfully",
        data: revisedCase,
      });
    } catch (error) {
      console.error("Failed to reopen case study:", error);

      res.status(500).json({
        success: false,
        message: "Failed to reopen case study for revision",
      });
    }
  }
);

// POST /api/cases/:id/revisions
// Create a new draft version from the latest validated case
router.post(
  "/:id/revisions",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;

    try {
      const originalCase = await prisma.validatedCase.findUnique({
        where: { id },
      });

      if (!originalCase) {
        res.status(404).json({
          success: false,
          message: "Case study not found",
        });
        return;
      }

      if (originalCase.validationStatus !== "VALIDATED") {
        res.status(409).json({
          success: false,
          message: "Only validated case studies can be revised",
        });
        return;
      }

      const latestVersion = await prisma.validatedCase.findFirst({
        where: {
          caseGroupId: originalCase.caseGroupId,
        },
        orderBy: {
          version: "desc",
        },
        select: {
          version: true,
        },
      });

      if (
        !latestVersion ||
        latestVersion.version !== originalCase.version
      ) {
        res.status(409).json({
          success: false,
          message: "Only the latest version can be revised",
        });
        return;
      }

      const revisedCase = await prisma.validatedCase.create({
        data: {
          caseGroupId: originalCase.caseGroupId,
          version: originalCase.version + 1,

          title: originalCase.title,
          context: originalCase.context,
          topic: originalCase.topic,
          stimulus: originalCase.stimulus,

          scientificData:
            originalCase.scientificData === null
              ? Prisma.JsonNull
              : (originalCase.scientificData as Prisma.InputJsonValue),

          targetConcept: originalCase.targetConcept,

          possibleMisconceptions:
            originalCase.possibleMisconceptions === null
              ? Prisma.JsonNull
              : (originalCase.possibleMisconceptions as Prisma.InputJsonValue),

          expertAnswer: originalCase.expertAnswer,

          validationStatus: "DRAFT",
          validatorId: null,
          validatedAt: null,
          rejectionReason: null,
        },
        select: {
          id: true,
          caseGroupId: true,
          title: true,
          version: true,
          validationStatus: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        success: true,
        message: "New case study revision created successfully",
        data: revisedCase,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        res.status(409).json({
          success: false,
          message:
            "A revision already exists. Please refresh the case study.",
        });
        return;
      }

      console.error("Failed to create case revision:", error);

      res.status(500).json({
        success: false,
        message: "Failed to create case study revision",
      });
    }
  }
);

// GET /api/cases/:id/versions
// Retrieve case study version history
router.get(
  "/:id/versions",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const parsedId = caseIdSchema.safeParse(req.params.id);

    if (!parsedId.success) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    const id = parsedId.data;

    try {
      const caseStudy = await prisma.validatedCase.findUnique({
        where: { id },
        select: {
          id: true,
          caseGroupId: true,
        },
      });

      if (!caseStudy) {
        res.status(404).json({
          success: false,
          message: "Case study not found",
        });
        return;
      }

      const versions = await prisma.validatedCase.findMany({
        where: {
          caseGroupId: caseStudy.caseGroupId,
        },
        select: {
          id: true,
          caseGroupId: true,
          title: true,
          version: true,
          validationStatus: true,
          validatorId: true,
          validatedAt: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          version: "asc",
        },
      });

      res.status(200).json({
        success: true,
        message: "Case study version history retrieved successfully",
        data: {
          caseGroupId: caseStudy.caseGroupId,
          totalVersions: versions.length,
          versions,
        },
      });
    } catch (error) {
      console.error("Failed to retrieve case version history:", error);

      res.status(500).json({
        success: false,
        message: "Failed to retrieve case study version history",
      });
    }
  }
);

export default router;