import { z } from "zod";

export const attemptIdSchema = z.uuid();

const answerItemSchema = z
  .object({
    questionId: z.uuid(),
    answer: z.string().trim().min(1).max(10000),
  })
  .strict();

export const saveAssessmentAnswersSchema = z
  .object({
    answers: z.array(answerItemSchema).min(1).max(100),
  })
  .strict()
  .superRefine((data, ctx) => {
    const questionIds = data.answers.map(
      (item) => item.questionId
    );

    if (new Set(questionIds).size !== questionIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["answers"],
        message: "Duplicate question IDs are not allowed",
      });
    }
  });