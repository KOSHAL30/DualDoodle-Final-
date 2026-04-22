import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { SessionModel } from "../models/Session";
import { DrawingModel } from "../models/Drawing";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

router.post("/sessions", requireAuth, sessionLimiter, async (req, res) => {
  try {
    let code = generateCode();
    for (let attempts = 0; attempts < 5; attempts++) {
      const exists = await SessionModel.findOne({ code });
      if (!exists) break;
      code = generateCode();
    }
    const session = await SessionModel.create({
      code,
      creatorId: req.auth!.userId,
      creatorUsername: req.auth!.username,
      status: "waiting",
    });
    return res.status(201).json({ session: serialize(session) });
  } catch (err) {
    req.log.error({ err }, "create session failed");
    return res.status(500).json({ error: "Failed to create session" });
  }
});

router.post("/sessions/:code/join", requireAuth, sessionLimiter, async (req, res) => {
  try {
    const code = String(req.params["code"]).toUpperCase();
    const session = await SessionModel.findOne({ code });
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status === "ended") {
      return res.status(410).json({ error: "Session has ended" });
    }
    const userId = req.auth!.userId;

    if (String(session.creatorId) === userId) {
      return res.json({ session: serialize(session), role: "creator" });
    }
    if (session.joinerId && String(session.joinerId) === userId) {
      return res.json({ session: serialize(session), role: "joiner" });
    }
    if (session.joinerId) {
      return res.status(409).json({ error: "Session is full" });
    }
    session.joinerId = userId as unknown as typeof session.joinerId;
    session.joinerUsername = req.auth!.username;
    session.status = "active";
    await session.save();
    return res.json({ session: serialize(session), role: "joiner" });
  } catch (err) {
    req.log.error({ err }, "join session failed");
    return res.status(500).json({ error: "Failed to join session" });
  }
});

router.get("/sessions/:code", requireAuth, async (req, res) => {
  try {
    const code = String(req.params["code"]).toUpperCase();
    const session = await SessionModel.findOne({ code });
    if (!session) return res.status(404).json({ error: "Session not found" });
    const userId = req.auth!.userId;
    let role: "creator" | "joiner" | null = null;
    if (String(session.creatorId) === userId) role = "creator";
    else if (session.joinerId && String(session.joinerId) === userId) role = "joiner";
    if (!role) return res.status(403).json({ error: "Not a participant" });
    return res.json({ session: serialize(session), role });
  } catch (err) {
    req.log.error({ err }, "get session failed");
    return res.status(500).json({ error: "Failed to load session" });
  }
});

router.post("/sessions/:code/end", requireAuth, async (req, res) => {
  try {
    const code = String(req.params["code"]).toUpperCase();
    const session = await SessionModel.findOne({ code });
    if (!session) return res.status(404).json({ error: "Session not found" });
    const userId = req.auth!.userId;
    if (
      String(session.creatorId) !== userId &&
      (!session.joinerId || String(session.joinerId) !== userId)
    ) {
      return res.status(403).json({ error: "Not a participant" });
    }
    session.status = "ended";
    session.endedAt = new Date();
    await session.save();
    return res.json({ session: serialize(session) });
  } catch (err) {
    req.log.error({ err }, "end session failed");
    return res.status(500).json({ error: "Failed to end session" });
  }
});

router.post("/sessions/:code/save", requireAuth, async (req, res) => {
  try {
    const code = String(req.params["code"]).toUpperCase();
    const { imageData } = req.body ?? {};
    if (typeof imageData !== "string" || !imageData.startsWith("data:image/")) {
      return res.status(400).json({ error: "imageData (data URL) is required" });
    }
    if (imageData.length > 8_000_000) {
      return res.status(413).json({ error: "Image too large" });
    }
    const session = await SessionModel.findOne({ code });
    if (!session) return res.status(404).json({ error: "Session not found" });
    const userId = req.auth!.userId;
    let partner = "Unknown";
    if (String(session.creatorId) === userId) {
      partner = session.joinerUsername || "Solo";
    } else if (session.joinerId && String(session.joinerId) === userId) {
      partner = session.creatorUsername;
    } else {
      return res.status(403).json({ error: "Not a participant" });
    }
    const drawing = await DrawingModel.create({
      ownerId: userId,
      partnerUsername: partner,
      imageData,
      sessionCode: code,
    });
    return res.status(201).json({
      drawing: {
        id: String(drawing._id),
        partnerUsername: drawing.partnerUsername,
        sessionCode: drawing.sessionCode,
        createdAt: drawing.createdAt,
      },
    });
  } catch (err) {
    req.log.error({ err }, "save drawing failed");
    return res.status(500).json({ error: "Failed to save drawing" });
  }
});

router.get("/drawings", requireAuth, async (req, res) => {
  try {
    const drawings = await DrawingModel.find({ ownerId: req.auth!.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({
      drawings: drawings.map((d) => ({
        id: String(d._id),
        partnerUsername: d.partnerUsername,
        sessionCode: d.sessionCode,
        imageData: d.imageData,
        createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "list drawings failed");
    return res.status(500).json({ error: "Failed to load drawings" });
  }
});

router.delete("/drawings/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const drawing = await DrawingModel.findById(id);
    if (!drawing) return res.status(404).json({ error: "Not found" });
    if (String(drawing.ownerId) !== req.auth!.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await drawing.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "delete drawing failed");
    return res.status(500).json({ error: "Failed to delete drawing" });
  }
});

function serialize(session: InstanceType<typeof SessionModel>) {
  return {
    code: session.code,
    creatorId: String(session.creatorId),
    creatorUsername: session.creatorUsername,
    joinerId: session.joinerId ? String(session.joinerId) : null,
    joinerUsername: session.joinerUsername || null,
    status: session.status,
    referenceImage: session.referenceImage || null,
    strokes: session.strokes,
    createdAt: session.createdAt,
    endedAt: session.endedAt || null,
  };
}

export default router;
