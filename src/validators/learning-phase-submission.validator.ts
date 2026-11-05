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

const optionalText = z
  .string()
  .trim()
  .max(10000, "Maximum 10000 characters.")
  .optional();

const questionText = z.string().trim().min(1).max(1000);

// A prompt shown to the student together with the answer,
// so history and grading keep the exact question that was asked.
const answeredPromptSchema = z
  .object({
    question: questionText,
    answer: requiredText,
  })
  .strict();

const answeredPromptsSchema = z.array(answeredPromptSchema).min(1).max(10);

// ==========================================
// PHASE 1 — INITIAL CONCEPTIONS
// ==========================================

export const phaseOneSubmissionSchema = z
  .object({
    answers: answeredPromptsSchema,
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
    responseTimeSeconds: z.number().int().min(0).max(86400).optional(),
  })
  .strict();

// ==========================================
// PHASES 2 & 3 — COGNITIVE CONFLICT / EVIDENCE
// ==========================================

export const promptAnswersSubmissionSchema = z
  .object({
    answers: answeredPromptsSchema,
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
    alternativeArgument: optionalText,
    revision: optionalText,
    questions: z
      .object({
        claim: questionText.optional(),
        evidence: questionText.optional(),
        reasoning: questionText.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ==========================================
// PHASE 5 — REFLECTION AND EVALUATION
// ==========================================

export const phaseFiveSubmissionSchema = z
  .object({
    understandingChange: requiredText,
    influentialEvidence: requiredText,
    questions: z
      .object({
        understandingChange: questionText.optional(),
        influentialEvidence: questionText.optional(),
      })
      .strict()
      .optional(),
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

    case 2:
    case 3:
      return promptAnswersSubmissionSchema.safeParse(content);

    case 4:
      return phaseFourSubmissionSchema.safeParse(content);

    case 5:
      return phaseFiveSubmissionSchema.safeParse(content);

    default:
      return {
        success: false as const,
        error: {
          message: "Invalid learning phase.",
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