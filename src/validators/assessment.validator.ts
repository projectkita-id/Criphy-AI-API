
import { z } from "zod";

export const assessmentIdSchema = z.uuid();

export const createAssessmentSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    type: z.enum(["PRE_TEST", "POST_TEST"]),
    moduleId: z.uuid(),
  })
  .strict();