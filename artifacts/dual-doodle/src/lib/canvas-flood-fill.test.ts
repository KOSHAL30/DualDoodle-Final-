import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floodFillPixels } from "./canvas-flood-fill.ts";

function makePixels(width: number, height: number, color: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset);
  return data;
}

describe("floodFillPixels", () => {
  it("fills an open 1200 by 900 region", () => {
    const width = 1200;
    const height = 900;
    const pixels = makePixels(width, height, [255, 255, 255, 255]);

    assert.equal(floodFillPixels(pixels, width, height, 600, 450, [20, 40, 60, 255]), true);
    assert.deepEqual([...pixels.slice(0, 4)], [20, 40, 60, 255]);
    assert.deepEqual([...pixels.slice(-4)], [20, 40, 60, 255]);
    assert.equal(floodFillPixels(pixels, width, height, 600, 450, [20, 40, 60, 255]), false);
  });

  it("does not cross a differently colored barrier", () => {
    const pixels = makePixels(3, 3, [255, 255, 255, 255]);
    pixels.set([0, 0, 0, 255], (1 * 3 + 1) * 4);

    assert.equal(floodFillPixels(pixels, 3, 3, 0, 0, [10, 20, 30, 255]), true);
    assert.deepEqual([...pixels.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)], [0, 0, 0, 255]);
    assert.deepEqual([...pixels.slice((2 * 3 + 2) * 4, (2 * 3 + 2) * 4 + 4)], [10, 20, 30, 255]);
  });

  it("rejects coordinates outside the image", () => {
    assert.equal(floodFillPixels(makePixels(2, 2, [255, 255, 255, 255]), 2, 2, -1, 0, [1, 2, 3, 255]), false);
  });
});
