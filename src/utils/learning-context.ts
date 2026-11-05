import { z } from "zod";

export const learningContextSchema = z.enum([
  "DAILY_LIFE",
  "ENVIRONMENT",
  "TECHNOLOGY",
]);

export type LearningContextValue = z.infer<typeof learningContextSchema>;

/** Reads an optional learning context from a query/body value. */
export function readLearningContext(value: unknown): LearningContextValue | null {
  const parsed = learningContextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
