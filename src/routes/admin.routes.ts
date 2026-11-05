import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma";
import { requireAuth } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { buildLearningHistory } from "../services/learning-history.service";

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

// GET /api/admin/students/:studentId/learning-history
router.get("/students/:studentId/learning-history", async (req, res) => {
  const parsedId = z.uuid().safeParse(req.params.studentId);

  if (!parsedId.success) {
    res.status(400).json({
      success: false,
      message: "Invalid student ID",
    });
    return;
  }

  try {
    const student = await prisma.user.findFirst({
      where: { id: parsedId.data, role: "STUDENT" },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    if (!student) {
      res.status(404).json({
        success: false,
        message: "Student not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Student learning history retrieved successfully",
      data: {
        student,
        history: await buildLearningHistory(student.id),
      },
    });
  } catch (error) {
    console.error("Failed to load student learning history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve student learning history",
    });
  }
});

export default router;