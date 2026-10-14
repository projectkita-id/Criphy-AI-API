import type {
  Request,
  Response,
  NextFunction,
} from "express";

import { env } from "../config/env";

const SAFE_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
]);

export function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("Origin");

  if (!origin || origin !== env.CLIENT_URL) {
    res.status(403).json({
      success: false,
      message: "Request origin is not allowed",
    });
    return;
  }

  next();
}