import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface IDrawing extends Document {
  ownerId: Types.ObjectId;
  partnerUsername: string;
  imageData: string;
  sessionCode: string;
  createdAt: Date;
}

const drawingSchema = new Schema<IDrawing>({
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  partnerUsername: { type: String, required: true },
  imageData: { type: String, required: true },
  sessionCode: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const DrawingModel = mongoose.model<IDrawing>("Drawing", drawingSchema);
