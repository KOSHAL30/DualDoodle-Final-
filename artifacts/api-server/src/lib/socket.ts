import { Server as SocketIOServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { verifyToken, type AuthPayload } from "./auth";
import { SessionModel, type IStroke } from "../models/Session";
import { logger } from "./logger";

interface SocketData {
  auth: AuthPayload;
  sessionCode?: string;
  role?: "creator" | "joiner";
  side?: "left" | "right";
}

export function attachSocketIO(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 5e6,
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as { token?: string } | undefined)?.token ||
      (socket.handshake.query["token"] as string | undefined);
    if (!token) return next(new Error("Missing auth token"));
    const payload = verifyToken(token);
    if (!payload) return next(new Error("Invalid token"));
    (socket.data as SocketData).auth = payload;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;
    logger.info({ user: data.auth.username }, "socket connected");

    socket.on("session:join", async (payload: { code: string }, ack?: (resp: unknown) => void) => {
      try {
        const code = String(payload?.code || "").toUpperCase();
        if (!code) return ack?.({ ok: false, error: "Missing code" });
        const session = await SessionModel.findOne({ code });
        if (!session) return ack?.({ ok: false, error: "Session not found" });
        if (session.status === "ended") {
          return ack?.({ ok: false, error: "Session has ended" });
        }
        const userId = data.auth.userId;
        let role: "creator" | "joiner";
        let side: "left" | "right";
        if (String(session.creatorId) === userId) {
          role = "creator";
          side = "left";
        } else if (session.joinerId && String(session.joinerId) === userId) {
          role = "joiner";
          side = "right";
        } else {
          return ack?.({ ok: false, error: "Not a participant" });
        }
        data.sessionCode = code;
        data.role = role;
        data.side = side;
        await socket.join(`session:${code}`);

        ack?.({
          ok: true,
          role,
          side,
          session: {
            code: session.code,
            creatorUsername: session.creatorUsername,
            joinerUsername: session.joinerUsername,
            status: session.status,
            referenceImage: session.referenceImage,
            strokes: session.strokes,
          },
        });

        socket.to(`session:${code}`).emit("presence:joined", {
          username: data.auth.username,
          role,
        });

        const sockets = await io.in(`session:${code}`).fetchSockets();
        const present = sockets.map((s) => {
          const sd = s.data as SocketData;
          return { username: sd.auth.username, role: sd.role };
        });
        io.to(`session:${code}`).emit("presence:state", { present });
      } catch (err) {
        logger.error({ err }, "session:join failed");
        ack?.({ ok: false, error: "Join failed" });
      }
    });

    socket.on("draw:stroke-start", (payload: Partial<IStroke>) => {
      if (!data.sessionCode || !data.side) return;
      socket.to(`session:${data.sessionCode}`).emit("draw:stroke-start", {
        ...payload,
        side: data.side,
        userId: data.auth.userId,
      });
    });

    socket.on("draw:stroke-progress", (payload: { points: Array<{ x: number; y: number }> }) => {
      if (!data.sessionCode || !data.side) return;
      socket.to(`session:${data.sessionCode}`).emit("draw:stroke-progress", {
        points: payload?.points || [],
        side: data.side,
        userId: data.auth.userId,
      });
    });

    socket.on("draw:stroke-end", async (payload: IStroke) => {
      if (!data.sessionCode || !data.side) return;
      const stroke: IStroke = {
        side: data.side,
        tool: String(payload?.tool || "pen"),
        color: String(payload?.color || "#000000"),
        size: Number(payload?.size) || 4,
        points: Array.isArray(payload?.points) ? payload.points.slice(0, 5000) : [],
        meta: payload?.meta,
        userId: data.auth.userId,
        ts: Date.now(),
      };
      socket.to(`session:${data.sessionCode}`).emit("draw:stroke-end", stroke);
      try {
        await SessionModel.updateOne(
          { code: data.sessionCode },
          { $push: { strokes: stroke } },
        );
      } catch (err) {
        logger.error({ err }, "persist stroke failed");
      }
    });

    socket.on("draw:undo", async (payload: { strokeIds?: number }) => {
      if (!data.sessionCode || !data.side) return;
      try {
        const session = await SessionModel.findOne({ code: data.sessionCode });
        if (!session) return;
        for (let i = session.strokes.length - 1; i >= 0; i--) {
          const s = session.strokes[i];
          if (s && s.userId === data.auth.userId) {
            session.strokes.splice(i, 1);
            break;
          }
        }
        await session.save();
        io.to(`session:${data.sessionCode}`).emit("draw:reset", {
          strokes: session.strokes,
        });
      } catch (err) {
        logger.error({ err }, "undo failed");
      }
    });

    socket.on("draw:clear-side", async () => {
      if (!data.sessionCode || !data.side) return;
      try {
        const session = await SessionModel.findOne({ code: data.sessionCode });
        if (!session) return;
        session.strokes = session.strokes.filter((s) => s.side !== data.side);
        await session.save();
        io.to(`session:${data.sessionCode}`).emit("draw:reset", {
          strokes: session.strokes,
        });
      } catch (err) {
        logger.error({ err }, "clear-side failed");
      }
    });

    socket.on(
      "reference:set",
      async (payload: { imageData: string | null }, ack?: (resp: unknown) => void) => {
        if (!data.sessionCode) return;
        try {
          const img = payload?.imageData;
          if (img !== null && (typeof img !== "string" || !img.startsWith("data:image/"))) {
            ack?.({ ok: false, error: "Invalid image" });
            return;
          }
          if (typeof img === "string" && img.length > 4_000_000) {
            ack?.({ ok: false, error: "Image too large" });
            return;
          }
          await SessionModel.updateOne(
            { code: data.sessionCode },
            { $set: { referenceImage: img } },
          );
          io.to(`session:${data.sessionCode}`).emit("reference:updated", { imageData: img });
          ack?.({ ok: true });
        } catch (err) {
          logger.error({ err }, "reference:set failed");
          ack?.({ ok: false, error: "Failed" });
        }
      },
    );

    socket.on("session:end", async () => {
      if (!data.sessionCode) return;
      try {
        await SessionModel.updateOne(
          { code: data.sessionCode },
          { $set: { status: "ended", endedAt: new Date() } },
        );
        io.to(`session:${data.sessionCode}`).emit("session:ended", {
          endedBy: data.auth.username,
        });
      } catch (err) {
        logger.error({ err }, "session:end failed");
      }
    });

    socket.on("disconnect", async () => {
      if (data.sessionCode) {
        socket.to(`session:${data.sessionCode}`).emit("presence:left", {
          username: data.auth.username,
          role: data.role,
        });
        const sockets = await io.in(`session:${data.sessionCode}`).fetchSockets();
        const present = sockets.map((s) => {
          const sd = s.data as SocketData;
          return { username: sd.auth.username, role: sd.role };
        });
        io.to(`session:${data.sessionCode}`).emit("presence:state", { present });
      }
    });
  });

  return io;
}
