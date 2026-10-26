import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pointerToCanvasPoint } from "./canvas-coordinates.ts";

const rect = { left: 100, top: 50, width: 600, height: 450 };

describe("pointerToCanvasPoint", () => {
  it("maps CSS coordinates into the fixed canvas resolution", () => {
    assert.deepEqual(pointerToCanvasPoint(400, 275, rect, 1200, 900), { x: 600, y: 450 });
  });

  it("maps all four edges to drawable pixels", () => {
    assert.deepEqual(pointerToCanvasPoint(100, 50, rect, 1200, 900), { x: 0, y: 0 });
    assert.deepEqual(pointerToCanvasPoint(700, 50, rect, 1200, 900), { x: 1199, y: 0 });
    assert.deepEqual(pointerToCanvasPoint(100, 500, rect, 1200, 900), { x: 0, y: 899 });
    assert.deepEqual(pointerToCanvasPoint(700, 500, rect, 1200, 900), { x: 1199, y: 899 });
  });

  it("clamps captured pointers outside the assigned canvas", () => {
    assert.deepEqual(pointerToCanvasPoint(-20, 900, rect, 1200, 900), { x: 0, y: 899 });
  });

  it("handles a temporarily zero-sized canvas", () => {
    assert.deepEqual(pointerToCanvasPoint(10, 10, { ...rect, width: 0 }, 1200, 900), { x: 0, y: 0 });
  });
});
