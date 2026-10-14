import { Router } from "express";

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

export default router;