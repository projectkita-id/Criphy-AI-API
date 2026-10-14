
import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "CRI-PHY AI API is running",
  });
});

export default app;