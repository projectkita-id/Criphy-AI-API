import type {
  Request,
  Response,
  NextFunction,
} from "express";

import type { Role } from "../generated/prisma/client";

export function requireRole(...allowedRoles: Role[]) {
  return (
    _req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const user = res.locals.user as
      | { role: Role }
      | undefined;

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource",
      });
      return;
    }

    next();
  };
}