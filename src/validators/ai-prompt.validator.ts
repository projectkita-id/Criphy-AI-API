import { z } from "zod";

export const phaseGuidanceSchema = z.object({
  phase1: z.string().trim().min(5),
  phase2: z.string().trim().min(5),
  phase3: z.string().trim().min(5),
  phase4: z.string().trim().min(5),
  phase5: z.string().trim().min(5),
});

export const createPromptConfigSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    role: z.string().trim().min(10).max(5000),
    objective: z.string().trim().min(10).max(5000),
    caseCharacteristics: z.string().trim().min(10).max(5000),
    guidanceStrategy: phaseGuidanceSchema,
    model: z.string().trim().min(2).max(100).default("gpt-4o"),
    temperature: z.number().min(0).max(2).default(0.3),
    maxTokens: z.number().int().min(100).max(4000).default(1000),
    isActive: z.boolean().default(true),
  })
  .strict();

export const updatePromptConfigSchema = createPromptConfigSchema
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field must be provided for update" }
  );

export const promptConfigIdSchema = z.string().uuid();
