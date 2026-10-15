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

export default app;