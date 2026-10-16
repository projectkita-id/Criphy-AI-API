import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env } from "./config/env";
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
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

export default app;