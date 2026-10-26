import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSessionPlayers, normalizeSessionStrokes, normalizeStrokeSide } from "./sessionNormalization.ts";

describe("legacy session normalization", () => {
  it("keeps current player slots and fills stable string IDs", () => {
    assert.deepEqual(normalizeSessionPlayers({
      creatorId: "creator",
      players: [{ userId: "creator", username: "Host", slot: 0 }],
    }), [{ userId: "creator", username: "Host", slot: 0 }]);
  });

  it("maps legacy creator and joiner fields to the first two slots", () => {
    assert.deepEqual(normalizeSessionPlayers({
      creatorId: "creator",
      creatorUsername: "Host",
      joinerId: "joiner",
      joinerUsername: "Guest",
    }), [
      { userId: "creator", username: "Host", slot: 0 },
      { userId: "joiner", username: "Guest", slot: 1 },
    ]);
  });

  it("normalizes old left/right stroke sides without moving current numeric slots", () => {
    assert.equal(normalizeStrokeSide("left"), 0);
    assert.equal(normalizeStrokeSide("right"), 1);
    assert.equal(normalizeStrokeSide(3), 3);
    assert.deepEqual(normalizeSessionStrokes([
      { side: "right", tool: "pen", color: "#000000", size: 4, points: [{ x: 1, y: 2 }], userId: "guest", ts: 1 },
    ]).map((stroke) => stroke.side), [1]);
  });
});
