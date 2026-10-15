import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// =====================================================
// GET /api/student/cases
// List latest VALIDATED case from each case group
// =====================================================

router.get(
  "/cases",
  requireAuth,
  requireRole("STUDENT"),
  async (_req, res) => {
    try {
      const validatedCases =
        await prisma.validatedCase.findMany({
          where: {
            validationStatus: "VALIDATED",
          },
          select: {
            id: true,
            caseGroupId: true,
            version: true,
            title: true,
            context: true,
            topic: true,
            createdAt: true,
          },
          orderBy: [
            { caseGroupId: "asc" },
            { version: "desc" },
          ],
        });

      // Since versions are ordered descending,
      // the first case in each group is the latest
      // VALIDATED version.
      const latestByGroup = new Map<
        string,
        (typeof validatedCases)[number]
      >();

      for (const caseStudy of validatedCases) {
        if (!latestByGroup.has(caseStudy.caseGroupId)) {
          latestByGroup.set(
            caseStudy.caseGroupId,
            caseStudy
          );
        }
      }

      // Sort selected cases by creation date,
      // then remove internal metadata.
      const cases = Array.from(latestByGroup.values())
        .sort(
          (a, b) =>
            b.createdAt.getTime() -
            a.createdAt.getTime()
        )
        .map((caseStudy) => ({
          id: caseStudy.id,
          title: caseStudy.title,
          context: caseStudy.context,
          topic: caseStudy.topic,
        }));

      res.status(200).json({
        success: true,
        message:
          "Available case studies retrieved successfully",
        data: cases,
      });
    } catch (error) {
      console.error(
        "Failed to retrieve student cases:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Failed to retrieve available case studies",
      });
    }
  }
);

// =====================================================
// GET /api/student/cases/:id
// Retrieve latest VALIDATED case details
// =====================================================

router.get(
  "/cases/:id",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    const { id } = req.params;

    // Validate UUID
    if (
      typeof id !== "string" ||
      !UUID_REGEX.test(id)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid case study ID",
      });
      return;
    }

    try {
      // Find the requested case.
      // Only VALIDATED cases are accessible.
      const caseStudy =
        await prisma.validatedCase.findFirst({
          where: {
            id,
            validationStatus: "VALIDATED",
          },
          select: {
            id: true,
            caseGroupId: true,
            title: true,
            context: true,
            topic: true,
            stimulus: true,
          },
        });

      if (!caseStudy) {
        res.status(404).json({
          success: false,
          message: "Case study not found",
        });
        return;
      }

      // Find the latest VALIDATED version
      // belonging to the same case group.
      const latestValidatedVersion =
        await prisma.validatedCase.findFirst({
          where: {
            caseGroupId: caseStudy.caseGroupId,
            validationStatus: "VALIDATED",
          },
          orderBy: {
            version: "desc",
          },
          select: {
            id: true,
          },
        });

      // Prevent access to older approved versions
      // through the general student endpoint.
      if (
        latestValidatedVersion?.id !== caseStudy.id
      ) {
        res.status(404).json({
          success: false,
          message: "Case study not found",
        });
        return;
      }

      // Return only student-safe fields.
      // Never expose expert answers or internal
      // scientific validation metadata.
      res.status(200).json({
        success: true,
        message: "Case study retrieved successfully",
        data: {
          id: caseStudy.id,
          title: caseStudy.title,
          context: caseStudy.context,
          topic: caseStudy.topic,
          stimulus: caseStudy.stimulus,
        },
      });
    } catch (error) {
      console.error(
        "Failed to retrieve student case:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to retrieve case study",
      });
    }
  }
);

export default router;