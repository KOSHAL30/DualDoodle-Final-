export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Map browser pointer coordinates into the fixed logical canvas pixel grid. */
export function pointerToCanvasPoint(
  clientX: number,
  clientY: number,
  rect: CanvasRect,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint {
  const width = Math.max(1, Math.floor(canvasWidth));
  const height = Math.max(1, Math.floor(canvasHeight));
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };

  const localX = Math.min(rect.width, Math.max(0, clientX - rect.left));
  const localY = Math.min(rect.height, Math.max(0, clientY - rect.top));
  return {
    x: Math.min(width - 1, Math.floor((localX / rect.width) * width)),
    y: Math.min(height - 1, Math.floor((localY / rect.height) * height)),
  };
}
