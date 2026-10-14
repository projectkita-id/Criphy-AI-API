import { Router } from "express";
import bcrypt from "bcryptjs";

import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { registerSchema, loginSchema } from "../validators/auth.validator";
import { requireAuth } from "../middlewares/auth.middleware";
import { signAccessToken } from "../utils/jwt";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  clearAuthCookieOptions,
} from "../config/cookie";

const router = Router();

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid registration data",
      errors: parsed.error.flatten(),
    });
    return;
  }

  const { name, email, password } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "STUDENT",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      success: true,
      message: "Student account created successfully",
      data: user,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({
        success: false,
        message: "Email is already registered",
      });
      return;
    }

    console.error("Registration failed:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create student account",
    });
  }
});


router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid login data",
    });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
      return;
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!passwordMatches) {
      res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
      return;
    }

    const token = signAccessToken(user.id);

    res.cookie(
      AUTH_COOKIE_NAME,
      token,
      authCookieOptions
    );

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login failed:", error);

    res.status(500).json({
      success: false,
      message: "Failed to log in",
    });
  }
});


router.get("/me", requireAuth, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Authenticated user retrieved successfully",
    data: res.locals.user,
  });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(
    AUTH_COOKIE_NAME,
    clearAuthCookieOptions
  );

  res.status(200).json({
    success: true,
    message: "Logout successful",
  });
});

export default router;