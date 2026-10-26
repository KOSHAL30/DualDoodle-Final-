import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendStroke, redoLastOwnStroke, undoLastOwnStroke } from "./drawingHistory.ts";

interface TestStroke {
  id: string;
  userId: string;
  ts: number;
}

const aliceA: TestStroke = { id: "a1", userId: "alice", ts: 1 };
const bobA: TestStroke = { id: "b1", userId: "bob", ts: 2 };
const aliceB: TestStroke = { id: "a2", userId: "alice", ts: 3 };

describe("drawing history", () => {
  it("undoes only the authenticated user's latest stroke", () => {
    const result = undoLastOwnStroke([aliceA, bobA, aliceB], [], "alice");
    assert.deepEqual(result.strokes, [aliceA, bobA]);
    assert.deepEqual(result.undoneStrokes, [{ ...aliceB, historyIndex: 2 }]);
    assert.equal(result.changed, true);
  });

  it("leaves history unchanged when the user has nothing to undo or redo", () => {
    const undo = undoLastOwnStroke([bobA], [], "alice");
    const redo = redoLastOwnStroke([bobA], [], "alice");
    assert.equal(undo.changed, false);
    assert.equal(redo.changed, false);
    assert.deepEqual(redo.strokes, [bobA]);
  });

  it("restores the user's latest undone stroke in drawing order", () => {
    const undone = undoLastOwnStroke([aliceA, bobA, aliceB], [], "alice");
    const result = redoLastOwnStroke([...undone.strokes, { id: "b2", userId: "bob", ts: 4 }], undone.undoneStrokes, "alice");
    assert.deepEqual(result.strokes, [aliceA, bobA, aliceB, { id: "b2", userId: "bob", ts: 4 }]);
    assert.deepEqual(result.undoneStrokes, []);
    assert.equal(result.changed, true);
  });

  it("clears the redo stack when a new stroke is recorded", () => {
    const result = appendStroke([aliceA], [aliceB], bobA);
    assert.deepEqual(result.strokes, [aliceA, bobA]);
    assert.deepEqual(result.undoneStrokes, []);
  });
});
