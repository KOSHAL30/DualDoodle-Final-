import { Server as SocketIOServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { verifyToken, type AuthPayload } from "./auth";
import { SessionModel, type IMessage, type IStroke } from "../models/Session";
import { logger } from "./logger";
import { normalizeMaxPlayers } from "./sessionCapacity";
import { appendStroke, redoLastOwnStroke, undoLastOwnStroke } from "./drawingHistory";
import { normalizeSessionPlayers, normalizeSessionStrokes } from "./sessionNormalization";
import { isValidReferenceDataUrl, MAX_CHAT_HISTORY, validateChatText } from "./roomEventValidation";
const MAX_STROKE_POINTS = 20_000;
const ROOM_STATE_TTL_MS = 30 * 60 * 1000;
const roomReferences = new Map<string, string | null>();
const roomMessages = new Map<string, IMessage[]>();
const roomStateCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sessionWriteQueues = new Map<string, Promise<void>>();
let socketServer: SocketIOServer | null = null;

interface SocketData {
  auth: AuthPayload;
  sessionCode?: string;
  role?: string;
  side?: number;
  sessionEnded?: boolean;
}

function getPresentUsers(sockets: Array<{ data: unknown }>) {
  const users = new Map<string, { username: string; role?: string }>();
  for (const presentSocket of sockets) {
    const data = presentSocket.data as SocketData;
    users.set(data.auth.userId, { username: data.auth.username, role: data.role });
  }
  return [...users.values()];
}

function isValidPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number" && Number.isFinite(point.x) && point.x >= 0 && point.x < 1200 &&
    typeof point.y === "number" && Number.isFinite(point.y) && point.y >= 0 && point.y < 900;
}

function isValidStroke(payload: Partial<IStroke>): boolean {
  const tools = new Set(["pen", "brush", "eraser", "line", "rectangle", "circle", "triangle", "fill"]);
  return typeof payload.tool === "string" && tools.has(payload.tool) &&
    typeof payload.color === "string" && /^#[0-9a-f]{6}$/i.test(payload.color) &&
    typeof payload.size === "number" && Number.isFinite(payload.size) && payload.size >= 1 && payload.size <= 48 &&
    Array.isArray(payload.points) && payload.points.length > 0 && payload.points.length <= MAX_STROKE_POINTS &&
    payload.points.every(isValidPoint);
}

function isValidMove(payload: Partial<IStroke>): boolean {
  return Array.isArray(payload.points) && payload.points.length > 0 && payload.points.length <= 300 &&
    payload.points.every(isValidPoint);
}

async function withSessionWriteLock<T>(code: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionWriteQueues.get(code) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  sessionWriteQueues.set(code, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (sessionWriteQueues.get(code) === current) sessionWriteQueues.delete(code);
  }
}

function clearRoomStateCleanup(code: string): void {
  const timer = roomStateCleanupTimers.get(code);
  if (timer) clearTimeout(timer);
  roomStateCleanupTimers.delete(code);
}

function scheduleRoomStateCleanup(code: string): void {
  clearRoomStateCleanup(code);
  const timer = setTimeout(() => {
    void (async () => {
      const io = socketServer;
      try {
        if (!io || roomStateCleanupTimers.get(code) !== timer) return;
        const sockets = await io.in(`session:${code}`).fetchSockets();
        if (roomStateCleanupTimers.get(code) !== timer) return;
        if (sockets.length === 0) {
          roomReferences.delete(code);
          roomMessages.delete(code);
        }
      } catch (err) {
        logger.warn({ err, code }, "room state expiry check failed");
      } finally {
        if (roomStateCleanupTimers.get(code) === timer) roomStateCleanupTimers.delete(code);
      }
    })();
  }, ROOM_STATE_TTL_MS);
  timer.unref?.();
  roomStateCleanupTimers.set(code, timer);
}

export async function notifySessionEnded(code: string): Promise<void> {
  clearRoomStateCleanup(code);
  roomReferences.delete(code);
  roomMessages.delete(code);
  const io = socketServer;
  if (!io) return;
  const roomSockets = await io.in(`session:${code}`).fetchSockets();
  for (const roomSocket of roomSockets) {
    (roomSocket.data as SocketData).sessionEnded = true;
  }
  io.to(`session:${code}`).emit("session:ended");
}

export function attachSocketIO(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { 
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => callback(null, true), 
      credentials: true 
    },
    maxHttpBufferSize: 5e6,
  });
  socketServer = io;

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
        const players = normalizeSessionPlayers(session);
        const player = players.find((p) => String(p.userId) === userId);
        if (!player) {
          return ack?.({ ok: false, error: "Not a participant" });
        }
        const role = String(player.slot);
        const side = player.slot;

        if (data.sessionCode && data.sessionCode !== code) {
          const previousCode = data.sessionCode;
          await socket.leave(`session:${previousCode}`);
          const previousSockets = await io.in(`session:${previousCode}`).fetchSockets();
          io.to(`session:${previousCode}`).emit("presence:state", {
            present: getPresentUsers(previousSockets),
          });
          if (previousSockets.length === 0) scheduleRoomStateCleanup(previousCode);
        }

        data.sessionCode = code;
        data.role = role;
        data.side = side;
        data.sessionEnded = false;
        clearRoomStateCleanup(code);
        await socket.join(`session:${code}`);

        const messages = roomMessages.get(code) ?? (session.messages ?? []).slice(-MAX_CHAT_HISTORY);
        roomMessages.set(code, messages);

        ack?.({
          ok: true,
          role,
          side,
          session: {
            code: session.code,
            maxPlayers: normalizeMaxPlayers(session.maxPlayers),
            players,
            status: session.status,
            referenceImage: roomReferences.has(code)
              ? roomReferences.get(code) ?? null
              : session.referenceImage ?? null,
            strokes: normalizeSessionStrokes(session.strokes),
            undoneStrokes: normalizeSessionStrokes(session.undoneStrokes ?? []),
            messages,
          },
        });

        socket.to(`session:${code}`).emit("presence:joined", {
          username: data.auth.username,
          role,
        });

        const sockets = await io.in(`session:${code}`).fetchSockets();
        const present = getPresentUsers(sockets);
        io.to(`session:${code}`).emit("presence:state", { present });
      } catch (err) {
        logger.error({ err }, "session:join failed");
        ack?.({ ok: false, error: "Join failed" });
      }
    });

    socket.on("draw:stroke-start", (payload: Partial<IStroke>) => {
      if (!data.sessionCode || data.side === undefined || data.sessionEnded || !isValidStroke(payload)) return;
      socket.to(`session:${data.sessionCode}`).emit("draw:stroke-start", {
        ...payload,
        side: data.side,
        userId: data.auth.userId,
      });
    });

    socket.on("draw:stroke-move", (payload: Partial<IStroke>) => {
      if (!data.sessionCode || data.side === undefined || data.sessionEnded || !isValidMove(payload)) return;
      const progress = {
        ...payload,
        side: data.side,
        userId: data.auth.userId,
      };
      socket.to(`session:${data.sessionCode}`).emit("draw:stroke-move", progress);
    });

    socket.on("draw:stroke-end", async (payload: Partial<IStroke>, ack?: (response: unknown) => void) => {
      if (!data.sessionCode || data.side === undefined || data.sessionEnded || !isValidStroke(payload)) {
        ack?.({ ok: false, error: "Invalid stroke or inactive room" });
        return;
      }
      const strokeData = {
        tool: payload.tool!,
        color: payload.color!,
        size: payload.size!,
        points: payload.points!,
        side: data.side,
        userId: data.auth.userId,
        ts: Date.now(),
      } as IStroke;

      try {
        const code = data.sessionCode;
        await withSessionWriteLock(code, async () => {
          const session = await SessionModel.findOne({
            code,
            status: { $ne: "ended" },
            "players.userId": data.auth.userId,
          });
          if (!session) {
            data.sessionEnded = true;
            ack?.({ ok: false, error: "This room has ended or you are no longer a participant" });
            return;
          }
          const history = appendStroke(
            normalizeSessionStrokes(session.strokes),
            normalizeSessionStrokes(session.undoneStrokes ?? []),
            strokeData,
          );
          session.strokes = history.strokes as typeof session.strokes;
          session.undoneStrokes = history.undoneStrokes as typeof session.undoneStrokes;
          await session.save();
          socket.to(`session:${code}`).emit("draw:stroke-end", strokeData);
          ack?.({ ok: true });
        });
      } catch (err) {
        logger.error({ err }, "failed to save stroke");
        ack?.({ ok: false, error: "Stroke could not be saved" });
      }
    });

    socket.on("draw:undo", async (_payload: unknown, ack?: (response: unknown) => void) => {
      if (!data.sessionCode || data.side === undefined || data.sessionEnded) {
        ack?.({ ok: false, error: "You are not connected to an active room" });
        return;
      }
      try {
        await withSessionWriteLock(data.sessionCode, async () => {
          const session = await SessionModel.findOne({
            code: data.sessionCode,
            status: { $ne: "ended" },
            "players.userId": data.auth.userId,
          });
          if (!session) {
            data.sessionEnded = true;
            ack?.({ ok: false, error: "This room has ended" });
            return;
          }
          const history = undoLastOwnStroke(
            normalizeSessionStrokes(session.strokes),
            normalizeSessionStrokes(session.undoneStrokes ?? []),
            data.auth.userId,
          );
          if (!history.changed) {
            ack?.({ ok: false, error: "You have no drawing to undo" });
            return;
          }
          session.strokes = history.strokes as typeof session.strokes;
          session.undoneStrokes = history.undoneStrokes as typeof session.undoneStrokes;
          await session.save();
          io.to(`session:${data.sessionCode}`).emit("draw:sync", {
            strokes: normalizeSessionStrokes(session.strokes),
            undoneStrokes: normalizeSessionStrokes(session.undoneStrokes),
          });
          ack?.({ ok: true });
        });
      } catch (err) {
        logger.error({ err }, "undo failed");
        ack?.({ ok: false, error: "Undo failed. Please try again." });
      }
    });

    socket.on("draw:redo", async (_payload: unknown, ack?: (response: unknown) => void) => {
      if (!data.sessionCode || data.side === undefined || data.sessionEnded) {
        ack?.({ ok: false, error: "You are not connected to an active room" });
        return;
      }
      try {
        await withSessionWriteLock(data.sessionCode, async () => {
          const session = await SessionModel.findOne({
            code: data.sessionCode,
            status: { $ne: "ended" },
            "players.userId": data.auth.userId,
          });
          if (!session) {
            data.sessionEnded = true;
            ack?.({ ok: false, error: "This room has ended" });
            return;
          }
          const history = redoLastOwnStroke(
            normalizeSessionStrokes(session.strokes),
            normalizeSessionStrokes(session.undoneStrokes ?? []),
            data.auth.userId,
          );
          if (!history.changed) {
            ack?.({ ok: false, error: "You have no drawing to redo" });
            return;
          }
          session.strokes = history.strokes as typeof session.strokes;
          session.undoneStrokes = history.undoneStrokes as typeof session.undoneStrokes;
          await session.save();
          io.to(`session:${data.sessionCode}`).emit("draw:sync", {
            strokes: normalizeSessionStrokes(session.strokes),
            undoneStrokes: normalizeSessionStrokes(session.undoneStrokes),
          });
          ack?.({ ok: true });
        });
      } catch (err) {
        logger.error({ err }, "redo failed");
        ack?.({ ok: false, error: "Redo failed. Please try again." });
      }
    });

    socket.on("draw:clear", async (_payload: unknown, ack?: (response: unknown) => void) => {
      if (!data.sessionCode || data.side === undefined || data.sessionEnded) {
        ack?.({ ok: false, error: "You are not connected to an active room" });
        return;
      }
      try {
        await withSessionWriteLock(data.sessionCode, async () => {
          const session = await SessionModel.findOne({
            code: data.sessionCode,
            status: { $ne: "ended" },
            "players.userId": data.auth.userId,
          });
          if (!session) {
            data.sessionEnded = true;
            ack?.({ ok: false, error: "This room has ended" });
            return;
          }
          const strokes = normalizeSessionStrokes(session.strokes);
          const userStrokes = strokes.filter((s) => s.userId === data.auth.userId);
          if (userStrokes.length === 0) {
            ack?.({ ok: false, error: "You have no drawings to clear" });
            return;
          }
          const remainingStrokes = strokes.filter((s) => s.userId !== data.auth.userId);
          const undone = [
            ...normalizeSessionStrokes(session.undoneStrokes ?? []),
            ...userStrokes,
          ];
          session.strokes = remainingStrokes as typeof session.strokes;
          session.undoneStrokes = undone as typeof session.undoneStrokes;
          await session.save();
          io.to(`session:${data.sessionCode}`).emit("draw:sync", {
            strokes: remainingStrokes,
            undoneStrokes: undone,
          });
          ack?.({ ok: true });
        });
      } catch (err) {
        logger.error({ err }, "clear failed");
        ack?.({ ok: false, error: "Clear failed. Please try again." });
      }
    });

    async function setReference(imageData: string | null) {
      if (!data.sessionCode || data.sessionEnded) return { ok: false, error: "Not in an active room" };
      if (imageData !== null && !isValidReferenceDataUrl(imageData)) {
        return { ok: false, error: "Choose a supported image no larger than 3.5MB" };
      }
      try {
        const session = await SessionModel.exists({
          code: data.sessionCode,
          status: { $ne: "ended" },
          "players.userId": data.auth.userId,
        });
        if (!session) return { ok: false, error: "This room has ended or you are no longer a participant" };
        roomReferences.set(data.sessionCode, imageData);
        io.to(`session:${data.sessionCode}`).emit("reference:updated", { imageData });
        return { ok: true };
      } catch (err) {
        logger.error({ err }, "set ref failed");
        return { ok: false, error: "Failed to set reference" };
      }
    }

    socket.on("reference:set", async (payload: { imageData?: string | null }, ack?: (resp: unknown) => void) => {
      if (!payload || !Object.hasOwn(payload, "imageData") || (payload.imageData !== null && typeof payload.imageData !== "string")) {
        ack?.({ ok: false, error: "Invalid reference image" });
        return;
      }
      const imageData = payload.imageData;
      const result = await setReference(imageData);
      ack?.(result);
    });

    socket.on("session:end", async (_payload: unknown, ack?: (response: unknown) => void) => {
      if (!data.sessionCode || data.sessionEnded) {
        ack?.({ ok: false, error: "You are not connected to an active room" });
        return;
      }
      try {
        const code = data.sessionCode;
        const session = await SessionModel.findOneAndUpdate(
          { code, status: { $ne: "ended" }, "players.userId": data.auth.userId },
          { $set: { status: "ended", endedAt: new Date() } },
          { new: true },
        );
        if (!session) {
          data.sessionEnded = true;
          ack?.({ ok: false, error: "This room has ended or you are not a participant" });
          return;
        }
        await notifySessionEnded(code);
        ack?.({ ok: true });
      } catch (err) {
        logger.error({ err }, "session:end failed");
        ack?.({ ok: false, error: "Could not end this session" });
      }
    });

    socket.on("chat:message", async (payload: { text?: unknown }, ack?: (response: unknown) => void) => {
      if (!data.sessionCode || data.sessionEnded) {
        ack?.({ ok: false, error: "You are not connected to an active room" });
        return;
      }
      const validation = validateChatText(payload?.text);
      if (!validation.ok) {
        ack?.({ ok: false, error: validation.error });
        return;
      }
      try {
        const session = await SessionModel.exists({
          code: data.sessionCode,
          status: { $ne: "ended" },
          "players.userId": data.auth.userId,
        });
        if (!session) {
          data.sessionEnded = true;
          ack?.({ ok: false, error: "This room has ended or you are no longer a participant" });
          return;
        }
        const msg = {
          id: randomUUID(),
          userId: data.auth.userId,
          username: data.auth.username,
          text: validation.text,
          ts: Date.now(),
        };
        const messages = [...(roomMessages.get(data.sessionCode) ?? []), msg].slice(-MAX_CHAT_HISTORY);
        roomMessages.set(data.sessionCode, messages);
        io.to(`session:${data.sessionCode}`).emit("chat:message", msg);
        ack?.({ ok: true });
      } catch (err) {
        logger.error({ err }, "chat message failed");
        ack?.({ ok: false, error: "Message could not be sent" });
      }
    });

    socket.on("disconnect", async () => {
      if (data.sessionCode) {
        try {
          const sockets = await io.in(`session:${data.sessionCode}`).fetchSockets();
          const present = getPresentUsers(sockets);
          io.to(`session:${data.sessionCode}`).emit("presence:state", { present });
          if (sockets.length === 0 && !data.sessionEnded) scheduleRoomStateCleanup(data.sessionCode);
        } catch (err) {
          logger.warn({ err, code: data.sessionCode }, "room disconnect cleanup failed");
        }
      }
      logger.info({ user: data.auth.username }, "socket disconnected");
    });
  });

  return io;
}
