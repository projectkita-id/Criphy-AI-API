
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env";

const isDevelopment = env.NODE_ENV === "development";

export const loginLimiter = rateLimit({
  windowMs: isDevelopment
    ? 2 * 60 * 1000
    : 15 * 60 * 1000,

  limit: 10,

  standardHeaders: "draft-8",
  legacyHeaders: false,

  message: {
    success: false,
    message: isDevelopment
      ? "Terlalu banyak percobaan masuk. Coba lagi dalam 2 menit."
      : "Terlalu banyak percobaan masuk. Silakan coba lagi nanti.",
  },
});

export const registerLimiter = rateLimit({
  windowMs: isDevelopment
    ? 5 * 60 * 1000
    : 60 * 60 * 1000,

  limit: isDevelopment ? 10 : 5,

  standardHeaders: "draft-8",
  legacyHeaders: false,

  message: {
    success: false,
    message: "Terlalu banyak percobaan pendaftaran. Silakan coba lagi nanti.",
  },
});
