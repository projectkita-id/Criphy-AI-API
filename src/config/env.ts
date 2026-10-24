import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(5000),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),

  JWT_EXPIRES_IN: z.literal("1h").default("1h"),

  CLIENT_URL: z.url(),

  OPENAI_API_KEY: z.string().optional(),

  OPENAI_MODEL: z.string().default("gpt-4o"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment configuration:",
    z.treeifyError(parsed.error)
  );

  throw new Error("Environment configuration is invalid");
}

export const env = parsed.data;