
import { z } from "zod";

// Validate UUID route parameters
export const moduleIdSchema = z.uuid();

// Validate new learning module data
export const createModuleSchema = z
  .object({
    title: z.string().trim().min(3).max(200),

    description: z
      .string()
      .trim()
      .max(5000)
      .optional(),

    topic: z.string().trim().min(2).max(200),

    version: z.number().int().positive().default(1),

    gradeLevel: z.string().trim().min(2).max(100),

    learningObjectives: z
      .string()
      .trim()
      .min(1)
      .max(10000),

    targetConcepts: z
      .string()
      .trim()
      .min(1)
      .max(10000),

    caseId: z.uuid(),
  })
  .strict();


export const updateModuleSchema = createModuleSchema
  .omit({ version: true })
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field must be provided",
    }
  );
