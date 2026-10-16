import { z } from "zod";

const questionBase = {
  questionText: z.string().trim().min(5).max(10000),
  order: z.number().int().positive(),
  maxScore: z.number().positive().finite().default(1),
  indicator: z.string().trim().min(2).max(100).optional(),
};

const mcqOptionSchema = z.object({
  key: z.string().trim().min(1).max(10),
  text: z.string().trim().min(1).max(1000),
}).strict();

const mcqQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("MCQ"),
  options: z.array(mcqOptionSchema).min(2).max(10),
  correctAnswer: z.string().trim().min(1).max(10),
}).strict().superRefine((data, ctx) => {
  const keys = data.options.map((option) => option.key);

  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: "Option keys must be unique",
    });
  }

  if (!keys.includes(data.correctAnswer)) {
    ctx.addIssue({
      code: "custom",
      path: ["correctAnswer"],
      message: "Correct answer must match an option key",
    });
  }
});

const essayQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("ESSAY"),
  rubric: z.string().trim().min(5).max(10000),
}).strict();

export const createAssessmentQuestionSchema =
  z.discriminatedUnion("type", [
    mcqQuestionSchema,
    essayQuestionSchema,
  ]);

export const updateAssessmentQuestionSchema =
  createAssessmentQuestionSchema;