import { z } from "zod";

export const createCaseSchema = z.object({
  title: z.string().trim().min(3).max(200),

  context: z.enum([
    "DAILY_LIFE",
    "ENVIRONMENT",
    "TECHNOLOGY",
  ]),

  topic: z.string().trim().min(3).max(200),

  stimulus: z.string().trim().min(10).max(10000),

  scientificData: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional(),

  targetConcept: z.string().trim().min(3).max(5000),

  possibleMisconceptions: z
    .array(z.string().trim().min(1).max(1000))
    .max(30)
    .nullable()
    .optional(),

  expertAnswer: z.string().trim().min(10).max(10000),
}).strict();

export const updateCaseSchema = createCaseSchema
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field must be provided" }
  );

export const listCasesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
