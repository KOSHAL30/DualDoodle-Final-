import assert from "node:assert/strict";
import { test } from "node:test";
import { consumePostAuthRedirect } from "./auth-redirect.ts";

function withRedirect(value: string | null, run: () => void) {
  let current = value;
  globalThis.sessionStorage = {
    getItem: () => current,
    removeItem: () => { current = null; },
    setItem: (_key: string, next: string) => { current = next; },
    clear: () => { current = null; },
    key: () => null,
    get length() { return current === null ? 0 : 1; },
  } as Storage;
  run();
  assert.equal(current, null, "the redirect should be consumed");
}

test("returns a saved room destination after authentication", () => {
  withRedirect("/room/ABC123", () => {
    assert.equal(consumePostAuthRedirect(), "/room/ABC123");
  });
});

test("rejects external and malformed destinations", () => {
  for (const target of ["//example.com", "https://example.com", "/room/../../login", "/login"]) {
    withRedirect(target, () => {
      assert.equal(consumePostAuthRedirect(), "/dashboard");
    });
  }
});

test("defaults to the dashboard when there is no saved destination", () => {
  withRedirect(null, () => {
    assert.equal(consumePostAuthRedirect(), "/dashboard");
  });
});
