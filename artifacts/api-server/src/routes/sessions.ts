import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { SessionModel } from "../models/Session";
import { DrawingModel } from "../models/Drawing";
import { requireAuth } from "../lib/auth";
import { capacityExpr, normalizeMaxPlayers, parseRequestedCapacity } from "../lib/sessionCapacity";
import { notifySessionEnded } from "../lib/socket";
import { normalizeSessionPlayers, normalizeSessionStrokes } from "../lib/sessionNormalization";
import { drawingCollaboratorLabel } from "../lib/drawingCollaborators";

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
    const maxPlayers = parseRequestedCapacity(req.body?.maxPlayers);
    if (maxPlayers === null) {
      return res.status(400).json({ error: "maxPlayers must be 2, 3, or 4" });
    }
    let code = generateCode();
    for (let attempts = 0; attempts < 5; attempts++) {
      const exists = await SessionModel.findOne({ code });
      if (!exists) break;
      code = generateCode();
    }
    const session = await SessionModel.create({
      code,
      creatorId: req.auth!.userId,
      maxPlayers,
      players: [{ userId: req.auth!.userId, username: req.auth!.username, slot: 0 }],
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
    let session = await SessionModel.findOne({ code });
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status === "ended") return res.status(410).json({ error: "Session has ended" });
    const userId = req.auth!.userId;
    const username = req.auth!.username;
    let players = normalizeSessionPlayers(session);

    if (!(session.players?.length) && players.length > 0) {
      const migrated = await SessionModel.findOneAndUpdate(
        {
          _id: session._id,
          status: { $ne: "ended" },
          $or: [{ players: { $size: 0 } }, { players: { $exists: false } }],
        },
        { $set: { players } },
        { new: true },
      );
      if (migrated) session = migrated;
      players = normalizeSessionPlayers(session);
    }

    const existingPlayer = players.find((p) => String(p.userId) === userId);
    if (existingPlayer) {
      return res.json({ session: serialize(session), role: existingPlayer.slot });
    }

    if (players.length === 0 && String(session.creatorId) === userId) {
      const restored = await SessionModel.findOneAndUpdate(
        {
          _id: session._id,
          status: { $ne: "ended" },
          $or: [{ players: { $size: 0 } }, { players: { $exists: false } }],
        },
        { $set: { players: [{ userId, username, slot: 0 }] } },
        { new: true },
      );
      return res.json({ session: serialize(restored ?? session), role: 0 });
    }

    const updated = await SessionModel.findOneAndUpdate(
      {
        _id: session._id,
        status: { $ne: "ended" },
        "players.userId": { $ne: userId },
        $expr: {
          $lt: [{ $size: { $ifNull: ["$players", []] } }, capacityExpr()],
        },
      },
      [
        {
          $set: {
            players: {
              $concatArrays: [
                { $ifNull: ["$players", []] },
                [
                  {
                    userId,
                    username,
                    slot: {
                      $min: {
                        $filter: {
                          input: [0, 1, 2, 3],
                          as: "s",
                          cond: {
                            $not: {
                              $in: [
                                "$$s",
                                {
                                  $map: {
                                    input: { $ifNull: ["$players", []] },
                                    as: "p",
                                    in: "$$p.slot",
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                    },
                  },
                ],
              ],
            },
          },
        },
        {
          $set: {
            status: {
              $cond: [
                { $gte: [{ $size: "$players" }, capacityExpr()] },
                "active",
                "$status",
              ],
            },
          },
        },
      ],
      { new: true, updatePipeline: true },
    );

    if (!updated) {
      const current = await SessionModel.findById(session._id);
      if (!current) return res.status(404).json({ error: "Session not found" });
      if (current.status === "ended") return res.status(410).json({ error: "Session has ended" });
      const currentPlayer = (current.players ?? []).find((p) => String(p.userId) === userId);
      if (currentPlayer) {
        return res.json({ session: serialize(current), role: currentPlayer.slot });
      }
      return res.status(409).json({ error: "Session is full" });
    }
    const joined = (updated.players ?? []).find((p) => String(p.userId) === userId);
    return res.json({ session: serialize(updated), role: joined?.slot ?? 0 });
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
    const player = normalizeSessionPlayers(session).find((p) => String(p.userId) === userId);
    if (!player) return res.status(403).json({ error: "Not a participant" });
    return res.json({ session: serialize(session), role: player.slot });
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
    const player = normalizeSessionPlayers(session).find((p) => String(p.userId) === userId);
    if (!player && String(session.creatorId) !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    session.status = "ended";
    session.endedAt = new Date();
    await session.save();
    await notifySessionEnded(code);
    return res.json({ session: serialize(session) });
  } catch (err) {
    req.log.error({ err }, "end session failed");
    return res.status(500).json({ error: "Failed to end session" });
  }
});

async function saveDrawing(req: Request, res: Response) {
  try {
    const code = String(req.params["code"]).toUpperCase();
    const { imageData } = req.body;
    if (typeof imageData !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(imageData)) {
      return res.status(400).json({ error: "imageData must be a PNG, JPEG, or WebP data URL" });
    }
    if (imageData.length > 8_000_000) return res.status(413).json({ error: "Image too large" });

    const session = await SessionModel.findOne({ code });
    if (!session) return res.status(404).json({ error: "Session not found" });
    const userId = req.auth!.userId;
    const player = normalizeSessionPlayers(session).find((p) => String(p.userId) === userId);
    if (!player) return res.status(403).json({ error: "Forbidden" });

    const collaboratorLabel = drawingCollaboratorLabel(normalizeSessionPlayers(session), userId);

    const drawing = await DrawingModel.create({
      ownerId: userId,
      sessionCode: code,
      partnerUsername: collaboratorLabel,
      imageData,
    });
    return res.status(201).json({ id: drawing.id });
  } catch (err) {
    req.log.error({ err }, "save drawing failed");
    return res.status(500).json({ error: "Failed to save drawing" });
  }
}

router.post("/sessions/:code/drawings", requireAuth, saveDrawing);
router.post("/sessions/:code/save", requireAuth, saveDrawing);

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
  const players = normalizeSessionPlayers(session);
  return {
    code: session.code,
    creatorId: String(session.creatorId),
    maxPlayers: normalizeMaxPlayers(session.maxPlayers),
    players: players.map((p) => ({ userId: String(p.userId), username: p.username, slot: p.slot })),
    status: session.status,
    referenceImage: session.referenceImage || null,
    strokes: normalizeSessionStrokes(session.strokes),
    undoneStrokes: session.undoneStrokes || [],
    messages: session.messages || [],
    createdAt: session.createdAt,
    endedAt: session.endedAt || null,
  };
}

export default router;
