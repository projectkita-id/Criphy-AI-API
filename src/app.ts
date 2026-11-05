import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env } from "./config/env";
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import aiPromptRoutes from "./routes/ai-prompt.routes";
import { requireTrustedOrigin } from "./middlewares/origin.middleware";
import caseRoutes from "./routes/case.routes";
import studentCaseRoutes from "./routes/student-case.routes";
import moduleRoutes from "./routes/module.routes";
import studentModuleRoutes from "./routes/student-module.routes";
import assessmentRoutes from "./routes/assessment.routes";
import assessmentQuestionRoutes from "./routes/assessment-question.routes";
import studentAssessmentRoutes from "./routes/student-assessment.routes";
import studentAnswerRoutes from "./routes/student-answer.routes";
import studentSubmitRoutes from "./routes/student-submit.routes";
import adminAssessmentGradingRoutes from "./routes/admin-assessment-grading.routes";
import studentAssessmentResultsRoutes from "./routes/student-assessment-results.routes";
import studentModuleAssignmentRoutes from "./routes/student-module-assignment.routes";
import studentLearningSessionRoutes from "./routes/student-learning-session.routes";
import materialRoutes from "./routes/material.routes";
import adminMonitoringRoutes from "./routes/admin-monitoring.routes";

const app = express();

app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use("/api", requireTrustedOrigin);

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", aiPromptRoutes);
app.use("/api/admin", materialRoutes);
app.use("/api/admin", adminMonitoringRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/student", studentCaseRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/student/modules", studentModuleRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/modules", assessmentQuestionRoutes);
app.use("/api/student", studentAssessmentRoutes);
app.use("/api/student", studentAnswerRoutes);
app.use("/api/student", studentSubmitRoutes);
app.use("/api/admin", adminAssessmentGradingRoutes);
app.use("/api/student", studentAssessmentResultsRoutes);
app.use("/api/student", studentModuleAssignmentRoutes);
app.use("/api/student", studentLearningSessionRoutes);

// Route tidak dikenal -> JSON, bukan halaman HTML bawaan Express.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message:
      "Fitur yang diminta belum tersedia di server. Pastikan server API sudah versi terbaru dan dijalankan ulang.",
  });
});

// Penangan error terakhir -> pesan yang mudah dipahami.
app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Ukuran file terlalu besar. Maksimal 15 MB."
        : "File yang diunggah tidak valid. Periksa kembali file kamu.";
    return res.status(400).json({ success: false, message });
  }

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ success: false, message: "Format data yang dikirim tidak valid." });
  }

  console.error(error);
  return res.status(500).json({
    success: false,
    message: "Terjadi kesalahan di server. Silakan coba lagi beberapa saat lagi.",
  });
});

export default app;