import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IStroke {
  side: "left" | "right";
  tool: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  meta?: Record<string, unknown>;
  userId: string;
  ts: number;
}

export interface ISession extends Document {
  code: string;
  creatorId: Types.ObjectId;
  creatorUsername: string;
  joinerId?: Types.ObjectId | null;
  joinerUsername?: string | null;
  status: "waiting" | "active" | "ended";
  strokes: IStroke[];
  referenceImage?: string | null;
  createdAt: Date;
  endedAt?: Date | null;
}

const strokeSchema = new Schema<IStroke>(
  {
    side: { type: String, enum: ["left", "right"], required: true },
    tool: { type: String, required: true },
    color: { type: String, required: true },
    size: { type: Number, required: true },
    points: [{ x: Number, y: Number }],
    meta: { type: Schema.Types.Mixed },
    userId: { type: String, required: true },
    ts: { type: Number, required: true },
  },
  { _id: false },
);

const sessionSchema = new Schema<ISession>({
  code: { type: String, required: true, unique: true, index: true },
  creatorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  creatorUsername: { type: String, required: true },
  joinerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  joinerUsername: { type: String, default: null },
  status: { type: String, enum: ["waiting", "active", "ended"], default: "waiting" },
  strokes: { type: [strokeSchema], default: [] },
  referenceImage: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
});

export const SessionModel = mongoose.model<ISession>("Session", sessionSchema);
