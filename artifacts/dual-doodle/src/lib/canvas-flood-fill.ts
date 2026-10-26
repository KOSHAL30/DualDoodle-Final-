export type RgbaColor = readonly [number, number, number, number];

/** Recolors a four-connected region in row-major RGBA pixel data. */
export function floodFillPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillColor: RgbaColor,
): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return false;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || data.length < pixelCount * 4) return false;

  const x = Math.floor(startX);
  const y = Math.floor(startY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= width || y < 0 || y >= height) return false;

  const startIndex = (y * width + x) * 4;
  const startR = data[startIndex]!;
  const startG = data[startIndex + 1]!;
  const startB = data[startIndex + 2]!;
  const startA = data[startIndex + 3]!;
  if (startR === fillColor[0] && startG === fillColor[1] && startB === fillColor[2] && startA === fillColor[3]) {
    return false;
  }

  const matches = (offset: number) =>
    data[offset] === startR && data[offset + 1] === startG && data[offset + 2] === startB && data[offset + 3] === startA;
  const visited = new Uint8Array(pixelCount);
  const stack = new Int32Array(pixelCount);
  let stackSize = 0;
  const startPixel = y * width + x;
  stack[stackSize++] = startPixel;
  visited[startPixel] = 1;

  while (stackSize > 0) {
    const seed = stack[--stackSize]!;
    const row = Math.floor(seed / width);
    const rowStart = row * width;
    const seedX = seed - rowStart;
    let left = seedX;
    let right = seedX;

    while (left > 0 && matches((rowStart + left - 1) * 4)) left--;
    while (right + 1 < width && matches((rowStart + right + 1) * 4)) right++;

    for (let spanX = left; spanX <= right; spanX++) {
      const offset = (rowStart + spanX) * 4;
      data[offset] = fillColor[0];
      data[offset + 1] = fillColor[1];
      data[offset + 2] = fillColor[2];
      data[offset + 3] = fillColor[3];
    }

    for (let direction = -1; direction <= 1; direction += 2) {
      const neighborRow = row + direction;
      if (neighborRow < 0 || neighborRow >= height) continue;
      let spanX = left;
      const neighborStart = neighborRow * width;
      while (spanX <= right) {
        const pixel = neighborStart + spanX;
        if (!visited[pixel] && matches(pixel * 4)) {
          const spanSeed = spanX;
          while (spanX <= right) {
            const candidate = neighborStart + spanX;
            if (visited[candidate] || !matches(candidate * 4)) break;
            visited[candidate] = 1;
            spanX++;
          }
          stack[stackSize++] = neighborStart + spanSeed;
        } else {
          spanX++;
        }
      }
    }
  }

  return true;
}
