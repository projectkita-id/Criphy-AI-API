import { z } from "zod";

// ==========================================
// LEARNING SESSION PARAMS
// ==========================================

export const learningSessionParamsSchema = z.object({
  sessionId: z.uuid(),
});

// ==========================================
// LEARNING PHASE PARAMS
// ==========================================

export const learningPhaseParamsSchema = z.object({
  sessionId: z.uuid(),
  phase: z.coerce.number().int().min(1).max(5),
});

// ==========================================
// SAVE PHASE RESPONSE
// ==========================================

export const savePhaseResponseSchema = z
  .object({
    answer: z.string().trim().min(1).max(10000),
    question: z.string().trim().min(1).max(10000).optional(),
  })
  .strict();

// ==========================================
// INFERRED TYPES
// ==========================================

export type LearningSessionParams = z.infer<
  typeof learningSessionParamsSchema
>;

export type LearningPhaseParams = z.infer<
  typeof learningPhaseParamsSchema
>;

export type SavePhaseResponseInput = z.infer<
  typeof savePhaseResponseSchema
>;