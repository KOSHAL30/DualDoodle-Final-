import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export function getJwtSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    if (process.env["NODE_ENV"] !== "production") {
      return "dualdoodle-dev-local-jwt-secret-key-123456789";
    }
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
}

export interface AuthPayload {
  userId: string;
  username: string;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthPayload;
    return { userId: decoded.userId, username: decoded.username };
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.auth = payload;
  next();
}
