import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { UserModel } from "../models/User";
import { signToken, requireAuth } from "../lib/auth";

const router: IRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later" },
});

router.post("/auth/signup", authLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body ?? {};
    if (
      typeof username !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({ error: "username, email and password are required" });
    }
    if (username.trim().length < 2 || username.trim().length > 32) {
      return res.status(400).json({ error: "Username must be 2-32 characters" });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const safeUsername = username.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await UserModel.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: { $regex: new RegExp(`^${safeUsername}$`, 'i') } }
      ],
    });
    if (existing) {
      return res.status(409).json({ error: "Username or email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await UserModel.create({
      username: username.trim(),
      email: email.toLowerCase(),
      passwordHash,
    });

    const token = signToken({ userId: String(user._id), username: user.username });
    return res.status(201).json({
      token,
      user: { id: String(user._id), username: user.username, email: user.email },
    });
  } catch (err) {
    req.log.error({ err }, "signup failed");
    return res.status(500).json({ error: "Signup failed" });
  }
});

router.post("/auth/login", authLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body ?? {};
    if (typeof identifier !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email/Username and password are required" });
    }
    const safeIdentifier = identifier.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const user = await UserModel.findOne({ 
      $or: [
        { email: identifier.toLowerCase() },
        { username: { $regex: new RegExp(`^${safeIdentifier}$`, 'i') } }
      ]
    });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = signToken({ userId: String(user._id), username: user.username });
    return res.json({
      token,
      user: { id: String(user._id), username: user.username, email: user.email },
    });
  } catch (err) {
    req.log.error({ err }, "login failed");
    return res.status(500).json({ error: "Login failed" });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await UserModel.findById(req.auth!.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({
      user: { id: String(user._id), username: user.username, email: user.email },
    });
  } catch (err) {
    req.log.error({ err }, "me failed");
    return res.status(500).json({ error: "Failed to load user" });
  }
});

export default router;
