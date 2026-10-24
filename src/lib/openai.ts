import OpenAI from "openai";
import { env } from "../config/env";

let openaiInstance: OpenAI | null = null;

export const getOpenAIClient = (): OpenAI => {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Please add your OpenAI API key in .env to enable AI tutoring features."
    );
  }

  if (!openaiInstance) {
    openaiInstance = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }

  return openaiInstance;
};
