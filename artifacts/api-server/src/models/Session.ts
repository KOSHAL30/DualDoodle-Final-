import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IStroke {
  side: number | "left" | "right";
  tool: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  meta?: Record<string, unknown>;
  historyIndex?: number;
  userId: string;
  ts: number;
}

export interface IMessage {
  id?: string;
  userId: string;
  username: string;
  text: string;
  ts: number;
}

export interface IPlayer {
  userId: string;
  username: string;
  slot: number;
}

export interface ISession extends Document {
  code: string;
  creatorId: Types.ObjectId;
  creatorUsername?: string;
  joinerId?: Types.ObjectId | null;
  joinerUsername?: string | null;
  maxPlayers: number;
  players: IPlayer[];
  status: "waiting" | "active" | "ended";
  strokes: IStroke[];
  undoneStrokes: IStroke[];
  messages: IMessage[];
  referenceImage?: string | null;
  createdAt: Date;
  endedAt?: Date | null;
}

const strokeSchema = new Schema<IStroke>(
  {
    side: { type: Schema.Types.Mixed, required: true },
    tool: { type: String, required: true },
    color: { type: String, required: true },
    size: { type: Number, required: true },
    points: [{ x: Number, y: Number }],
    meta: { type: Schema.Types.Mixed },
    historyIndex: { type: Number },
    userId: { type: String, required: true },
    ts: { type: Number, required: true },
  },
  { _id: false },
);

const messageSchema = new Schema<IMessage>(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
    text: { type: String, required: true },
    ts: { type: Number, required: true },
  },
  { _id: false },
);

const playerSchema = new Schema<IPlayer>(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
    slot: { type: Number, required: true },
  },
  { _id: false }
);

const sessionSchema = new Schema<ISession>({
  code: { type: String, required: true, unique: true, index: true },
  creatorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  creatorUsername: { type: String },
  joinerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  joinerUsername: { type: String, default: null },
  maxPlayers: { type: Number, default: 2, min: 2, max: 4 },
  players: { type: [playerSchema], default: [] },
  status: { type: String, enum: ["waiting", "active", "ended"], default: "waiting" },
  strokes: { type: [strokeSchema], default: [] },
  undoneStrokes: { type: [strokeSchema], default: [] },
  messages: { type: [messageSchema], default: [] },
  referenceImage: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
});

export const SessionModel = mongoose.model<ISession>("Session", sessionSchema);
