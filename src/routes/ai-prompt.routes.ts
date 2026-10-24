import { Router } from "express";
import { Prisma } from "../generated/prisma/client";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import {
  createPromptConfigSchema,
  promptConfigIdSchema,
  updatePromptConfigSchema,
} from "../validators/ai-prompt.validator";
import { DEFAULT_PROMPT_CONFIG } from "../services/ai-prompt.service";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN"));

// ==========================================
// GET /api/admin/prompts
// List all prompt configurations
// ==========================================
router.get("/prompts", async (_req, res) => {
  try {
    const configs = await prisma.aIPromptConfig.findMany({
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    });

    res.status(200).json({
      success: true,
      message: "AI prompt configurations retrieved successfully",
      data: {
        total: configs.length,
        defaultFallback: DEFAULT_PROMPT_CONFIG,
        configs,
      },
    });
  } catch (error) {
    console.error("Failed to retrieve prompt configs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve prompt configurations",
    });
  }
});

// ==========================================
// GET /api/admin/prompts/active
// Retrieve currently active prompt configuration
// ==========================================
router.get("/prompts/active", async (_req, res) => {
  try {
    const activeConfig = await prisma.aIPromptConfig.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    res.status(200).json({
      success: true,
      message: "Active prompt configuration retrieved successfully",
      data: activeConfig || DEFAULT_PROMPT_CONFIG,
    });
  } catch (error) {
    console.error("Failed to retrieve active prompt config:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve active prompt configuration",
    });
  }
});

// ==========================================
// GET /api/admin/prompts/:id
// Retrieve specific prompt configuration
// ==========================================
router.get("/prompts/:id", async (req, res) => {
  const parsedId = promptConfigIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({
      success: false,
      message: "Invalid prompt configuration ID",
    });
    return;
  }

  try {
    const config = await prisma.aIPromptConfig.findUnique({
      where: { id: parsedId.data },
    });

    if (!config) {
      res.status(404).json({
        success: false,
        message: "Prompt configuration not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Prompt configuration retrieved successfully",
      data: config,
    });
  } catch (error) {
    console.error("Failed to retrieve prompt config:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve prompt configuration",
    });
  }
});

// ==========================================
// POST /api/admin/prompts
// Create new customizable prompt configuration
// ==========================================
router.post("/prompts", async (req, res) => {
  const parsed = createPromptConfigSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid prompt configuration input",
      errors: parsed.error.flatten(),
    });
    return;
  }

  const data = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // If setting this config as active, deactivate other configs
      if (data.isActive) {
        await tx.aIPromptConfig.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }

      return await tx.aIPromptConfig.create({
        data: {
          name: data.name,
          role: data.role,
          objective: data.objective,
          caseCharacteristics: data.caseCharacteristics,
          guidanceStrategy: data.guidanceStrategy as Prisma.InputJsonObject,
          model: data.model,
          temperature: data.temperature,
          maxTokens: data.maxTokens,
          isActive: data.isActive,
          version: 1,
        },
      });
    });

    res.status(201).json({
      success: true,
      message: "AI prompt configuration created successfully",
      data: result,
    });
  } catch (error) {
    console.error("Failed to create prompt config:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create prompt configuration",
    });
  }
});

// ==========================================
// PUT /api/admin/prompts/:id
// Update prompt configuration (increments version)
// ==========================================
router.put("/prompts/:id", async (req, res) => {
  const parsedId = promptConfigIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({
      success: false,
      message: "Invalid prompt configuration ID",
    });
    return;
  }

  const parsedBody = updatePromptConfigSchema.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(400).json({
      success: false,
      message: "Invalid prompt update payload",
      errors: parsedBody.error.flatten(),
    });
    return;
  }

  const id = parsedId.data;
  const updates = parsedBody.data;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.aIPromptConfig.findUnique({
        where: { id },
      });

      if (!existing) {
        return null;
      }

      if (updates.isActive === true) {
        await tx.aIPromptConfig.updateMany({
          where: { id: { not: id }, isActive: true },
          data: { isActive: false },
        });
      }

      return await tx.aIPromptConfig.update({
        where: { id },
        data: {
          ...(updates.name && { name: updates.name }),
          ...(updates.role && { role: updates.role }),
          ...(updates.objective && { objective: updates.objective }),
          ...(updates.caseCharacteristics && {
            caseCharacteristics: updates.caseCharacteristics,
          }),
          ...(updates.guidanceStrategy && {
            guidanceStrategy: updates.guidanceStrategy as Prisma.InputJsonObject,
          }),
          ...(updates.model && { model: updates.model }),
          ...(typeof updates.temperature === "number" && {
            temperature: updates.temperature,
          }),
          ...(typeof updates.maxTokens === "number" && {
            maxTokens: updates.maxTokens,
          }),
          ...(typeof updates.isActive === "boolean" && {
            isActive: updates.isActive,
          }),
          version: existing.version + 1,
        },
      });
    });

    if (!updated) {
      res.status(404).json({
        success: false,
        message: "Prompt configuration not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "AI prompt configuration updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Failed to update prompt config:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update prompt configuration",
    });
  }
});

// ==========================================
// POST /api/admin/prompts/:id/activate
// Set prompt configuration as active
// ==========================================
router.post("/prompts/:id/activate", async (req, res) => {
  const parsedId = promptConfigIdSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({
      success: false,
      message: "Invalid prompt configuration ID",
    });
    return;
  }

  const id = parsedId.data;

  try {
    const activated = await prisma.$transaction(async (tx) => {
      const existing = await tx.aIPromptConfig.findUnique({
        where: { id },
      });

      if (!existing) {
        return null;
      }

      await tx.aIPromptConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      return await tx.aIPromptConfig.update({
        where: { id },
        data: { isActive: true },
      });
    });

    if (!activated) {
      res.status(404).json({
        success: false,
        message: "Prompt configuration not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "AI prompt configuration activated successfully",
      data: activated,
    });
  } catch (error) {
    console.error("Failed to activate prompt config:", error);
    res.status(500).json({
      success: false,
      message: "Failed to activate prompt configuration",
    });
  }
});

export default router;
