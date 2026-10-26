import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { drawingCollaboratorLabel } from "./drawingCollaborators.ts";
import { DrawingModel } from "../models/Drawing.ts";

describe("drawingCollaboratorLabel", () => {
  it("labels solo drawings without using an invalid empty required value", async () => {
    const label = drawingCollaboratorLabel([{ userId: "owner", username: "Owner", slot: 0 }], "owner");
    assert.equal(label, "Solo");
    const drawing = new DrawingModel({
      ownerId: new mongoose.Types.ObjectId(),
      sessionCode: "ABC123",
      partnerUsername: label,
      imageData: "data:image/png;base64,YWJj",
    });
    await assert.doesNotReject(drawing.validate());
  });

  it("includes every collaborator in multi-player rooms", () => {
    assert.equal(drawingCollaboratorLabel([
      { userId: "owner", username: "Owner", slot: 0 },
      { userId: "p2", username: "Alex", slot: 1 },
      { userId: "p3", username: "Sam", slot: 2 },
      { userId: "p4", username: "Alex", slot: 3 },
    ], "owner"), "Alex, Sam, Alex");
  });
});
