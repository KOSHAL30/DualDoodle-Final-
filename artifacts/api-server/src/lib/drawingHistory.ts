export interface HistoryStroke {
  userId: string;
  ts: number;
  historyIndex?: number;
}

export interface DrawingHistory<T extends HistoryStroke> {
  strokes: T[];
  undoneStrokes: T[];
  changed: boolean;
}

export function undoLastOwnStroke<T extends HistoryStroke>(
  strokes: readonly T[],
  undoneStrokes: readonly T[],
  userId: string,
): DrawingHistory<T> {
  const index = findLastUserStroke(strokes, userId);
  if (index < 0) return { strokes: [...strokes], undoneStrokes: [...undoneStrokes], changed: false };
  const nextStrokes = [...strokes];
  const [undone] = nextStrokes.splice(index, 1);
  if (!undone) return { strokes: [...strokes], undoneStrokes: [...undoneStrokes], changed: false };
  return {
    strokes: nextStrokes,
    undoneStrokes: [...undoneStrokes, { ...undone, historyIndex: index }],
    changed: true,
  };
}

export function redoLastOwnStroke<T extends HistoryStroke>(
  strokes: readonly T[],
  undoneStrokes: readonly T[],
  userId: string,
): DrawingHistory<T> {
  const index = findLastUserStroke(undoneStrokes, userId);
  if (index < 0) return { strokes: [...strokes], undoneStrokes: [...undoneStrokes], changed: false };
  const nextUndone = [...undoneStrokes];
  const [restored] = nextUndone.splice(index, 1);
  if (!restored) return { strokes: [...strokes], undoneStrokes: [...undoneStrokes], changed: false };
  const restoredStroke = { ...restored };
  const historyIndex = restoredStroke.historyIndex;
  delete restoredStroke.historyIndex;
  const nextStrokes = [...strokes];
  if (typeof historyIndex === "number" && Number.isInteger(historyIndex)) {
    nextStrokes.splice(Math.min(Math.max(historyIndex, 0), nextStrokes.length), 0, restoredStroke);
  } else {
    nextStrokes.push(restoredStroke);
    nextStrokes.sort((a, b) => a.ts - b.ts);
  }
  return { strokes: nextStrokes, undoneStrokes: nextUndone, changed: true };
}

export function appendStroke<T extends HistoryStroke>(
  strokes: readonly T[],
  _undoneStrokes: readonly T[],
  stroke: T,
): DrawingHistory<T> {
  return { strokes: [...strokes, stroke], undoneStrokes: [], changed: true };
}

function findLastUserStroke<T extends HistoryStroke>(strokes: readonly T[], userId: string): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokes[i]?.userId === userId) return i;
  }
  return -1;
}
