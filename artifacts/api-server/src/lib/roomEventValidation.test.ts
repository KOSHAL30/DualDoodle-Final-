import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidReferenceDataUrl, MAX_CHAT_LENGTH, validateChatText } from "./roomEventValidation.ts";

describe("room event validation", () => {
  it("trims and accepts bounded chat text", () => {
    assert.deepEqual(validateChatText("  hello  "), { ok: true, text: "hello" });
    assert.equal(validateChatText("x".repeat(MAX_CHAT_LENGTH)).ok, true);
  });

  it("rejects empty, non-text, and overlong chat messages", () => {
    assert.deepEqual(validateChatText("  "), { ok: false, error: "Message cannot be empty" });
    assert.deepEqual(validateChatText({ text: "hello" }), { ok: false, error: "Message text is required" });
    assert.equal(validateChatText("x".repeat(MAX_CHAT_LENGTH + 1)).ok, false);
  });

  it("accepts supported image data URLs and rejects other payloads", () => {
    assert.equal(isValidReferenceDataUrl("data:image/png;base64,YWJj"), true);
    assert.equal(isValidReferenceDataUrl("data:image/png;base64,"), false);
    assert.equal(isValidReferenceDataUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
    assert.equal(isValidReferenceDataUrl("not-an-image"), false);
  });
});
