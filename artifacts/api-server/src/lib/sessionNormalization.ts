import type { IPlayer, IStroke } from "../models/Session";

interface SessionPlayersSource {
  players?: readonly IPlayer[] | null;
  creatorId: unknown;
  creatorUsername?: string | null;
  joinerId?: unknown;
  joinerUsername?: string | null;
}

export function normalizeSessionPlayers(session: SessionPlayersSource): IPlayer[] {
  if (session.players?.length) {
    return session.players.map((player) => ({
      userId: String(player.userId),
      username: player.username,
      slot: player.slot,
    }));
  }

  const creatorId = session.creatorId == null ? "" : String(session.creatorId);
  if (!creatorId) return [];
  const players: IPlayer[] = [{
    userId: creatorId,
    username: session.creatorUsername || "Host",
    slot: 0,
  }];
  if (session.joinerId != null) {
    players.push({
      userId: String(session.joinerId),
      username: session.joinerUsername || "Player 2",
      slot: 1,
    });
  }
  return players;
}

export function normalizeStrokeSide(side: unknown): number {
  if (typeof side === "number" && Number.isInteger(side) && side >= 0 && side <= 3) return side;
  if (side === "right") return 1;
  return 0;
}

export function normalizeSessionStrokes(strokes: readonly unknown[] | null | undefined): IStroke[] {
  if (!strokes) return [];
  return strokes.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const stroke = value as Partial<IStroke> & { side?: unknown };
    if (!Array.isArray(stroke.points)) return [];
    return [{
      side: normalizeStrokeSide(stroke.side),
      tool: typeof stroke.tool === "string" ? stroke.tool : "pen",
      color: typeof stroke.color === "string" ? stroke.color : "#1a1a2e",
      size: typeof stroke.size === "number" && Number.isFinite(stroke.size) ? stroke.size : 4,
      points: stroke.points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)),
      ...(stroke.meta ? { meta: stroke.meta } : {}),
      ...(typeof stroke.historyIndex === "number" ? { historyIndex: stroke.historyIndex } : {}),
      userId: typeof stroke.userId === "string" ? stroke.userId : "",
      ts: typeof stroke.ts === "number" && Number.isFinite(stroke.ts) ? stroke.ts : 0,
    }];
  });
}
