import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getAdminById } from "@aviation/db";
import { env } from "../config/env";

export type AdminTokenPayload = {
  sub: string;
  role: string;
};

declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        email: string;
        role: string;
      };
    }
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AdminTokenPayload;
    const admin = await getAdminById(payload.sub);
    if (!admin || !admin.isActive) {
      res.status(401).json({ error: "Invalid admin token" });
      return;
    }
    req.admin = { id: admin.id, email: admin.email, role: admin.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid admin token" });
  }
}
