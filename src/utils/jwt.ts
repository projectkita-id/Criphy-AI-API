
import jwt from "jsonwebtoken";

import { env } from "../config/env";

export function signAccessToken(userId: string): string {
  return jwt.sign(
    {},
    env.JWT_SECRET,
    {
      subject: userId,
      expiresIn: "1h",
      algorithm: "HS256",
    }
  );
}