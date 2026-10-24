import { Router } from "express";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN"));

router.get("/test", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Admin access granted",
  });
});

router.get("/users", async (_req, res) => {
  try {
    const students = await prisma.user.findMany({
      where: {
        role: "STUDENT",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      success: true,
      message: "Students retrieved successfully",
      data: students,
    });
  } catch (error) {
    console.error("Failed to load students:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve students",
    });
  }
});

export default router;