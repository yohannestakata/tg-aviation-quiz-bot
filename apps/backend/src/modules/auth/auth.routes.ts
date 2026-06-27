import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { getAdminByEmail } from "@aviation/db";
import { env } from "../../config/env";
import { asyncHandler } from "../../middleware/async-handler";
import { requireAdmin } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import { loginSchema } from "./auth.schemas";

export const authRouter = Router();

authRouter.post(
  "/login",
  rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true }),
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const admin = await getAdminByEmail(req.body.email);
    if (!admin || !admin.isActive) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const passwordValid = await bcrypt.compare(req.body.password, admin.passwordHash);
    if (!passwordValid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = jwt.sign({ sub: admin.id, role: admin.role }, env.JWT_SECRET, { expiresIn: "8h" });
    res.json({
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role
      }
    });
  })
);

authRouter.post("/logout", (_req, res) => {
  res.status(204).send();
});

authRouter.get("/me", requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});
