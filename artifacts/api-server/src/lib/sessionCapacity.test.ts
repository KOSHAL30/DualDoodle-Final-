import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMaxPlayers, parseRequestedCapacity } from "./sessionCapacity.ts";

describe("parseRequestedCapacity", () => {
  it("defaults omitted values to 2", () => {
    assert.equal(parseRequestedCapacity(undefined), 2);
    assert.equal(parseRequestedCapacity(null), 2);
    assert.equal(parseRequestedCapacity(""), 2);
  });

  it("accepts 2, 3, and 4", () => {
    assert.equal(parseRequestedCapacity(2), 2);
    assert.equal(parseRequestedCapacity("3"), 3);
    assert.equal(parseRequestedCapacity(4), 4);
  });

  it("rejects unsupported capacities", () => {
    assert.equal(parseRequestedCapacity(1), null);
    assert.equal(parseRequestedCapacity(5), null);
    assert.equal(parseRequestedCapacity("full"), null);
    assert.equal(parseRequestedCapacity(2.5), null);
  });
});

describe("normalizeMaxPlayers", () => {
  it("preserves valid stored capacities", () => {
    assert.equal(normalizeMaxPlayers(3), 3);
    assert.equal(normalizeMaxPlayers("4"), 4);
  });

  it("defaults missing or invalid records to 2", () => {
    assert.equal(normalizeMaxPlayers(undefined), 2);
    assert.equal(normalizeMaxPlayers(null), 2);
    assert.equal(normalizeMaxPlayers(8), 2);
  });
});
