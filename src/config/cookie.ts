import type { CookieOptions } from "express";
import { env } from "./env";

export const AUTH_COOKIE_NAME = "criphy_session";

export const authCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 1000,
};

export const clearAuthCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};