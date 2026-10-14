import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "CRI-PHY AI API is running",
  });
});

router.get("/database", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      success: true,
      message: "PostgreSQL database is connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      success: false,
      message: "PostgreSQL database is unavailable",
    });
  }
});

export default router;