import { z } from "zod";

// ==========================================
// SHARED VALIDATION
// ==========================================

const requiredText = z
  .string()
  .trim()
  .min(1, "This field is required.")
  .max(10000, "Maximum 10000 characters.");

export const learningPhaseSubmissionParamsSchema = z.object({
  sessionId: z.uuid(),
  phase: z.coerce.number().int().min(1).max(5),
});

// ==========================================
// PHASE 1 — INITIAL CONCEPTIONS
// ==========================================

export const phaseOneSubmissionSchema = z
  .object({
    prediction: requiredText,
    reasoning: requiredText,
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  })
  .strict();

// ==========================================
// PHASE 4 — CER ARGUMENTATION
// ==========================================

export const phaseFourSubmissionSchema = z
  .object({
    claim: requiredText,
    evidence: requiredText,
    reasoning: requiredText,
    alternativeArgument: requiredText,
    revision: requiredText,
  })
  .strict();

// ==========================================
// PHASE 5 — REFLECTION AND EVALUATION
// ==========================================

export const phaseFiveSubmissionSchema = z
  .object({
    understandingChange: requiredText,
    influentialEvidence: requiredText,
  })
  .strict();

// ==========================================
// COMBINED VALIDATION
// ==========================================

export const validateLearningPhaseSubmission = (
  phase: number,
  content: unknown
) => {
  switch (phase) {
    case 1:
      return phaseOneSubmissionSchema.safeParse(content);

    case 4:
      return phaseFourSubmissionSchema.safeParse(content);

    case 5:
      return phaseFiveSubmissionSchema.safeParse(content);

    default:
      return {
        success: false as const,
        error: {
          message:
            "Structured submissions are currently supported only for phases 1, 4 and 5.",
        },
      };
  }
};

// ==========================================
// TYPES
// ==========================================

export type PhaseOneSubmission = z.infer<
  typeof phaseOneSubmissionSchema
>;

export type PhaseFourSubmission = z.infer<
  typeof phaseFourSubmissionSchema
>;

export type PhaseFiveSubmission = z.infer<
  typeof phaseFiveSubmissionSchema
>;

export const structuredPhaseSubmissionSchema = z
  .object({
    type: z.literal("SUBMISSION"),
    content: z.unknown(),
  })
  .strict();