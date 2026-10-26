export const MAX_CHAT_LENGTH = 500;
export const MAX_CHAT_HISTORY = 100;
export const MAX_REFERENCE_BYTES = 3_500_000;

export type ChatTextResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export function validateChatText(value: unknown): ChatTextResult {
  if (typeof value !== "string") return { ok: false, error: "Message text is required" };
  const text = value.trim();
  if (!text) return { ok: false, error: "Message cannot be empty" };
  if (text.length > MAX_CHAT_LENGTH) {
    return { ok: false, error: `Messages must be ${MAX_CHAT_LENGTH} characters or fewer` };
  }
  return { ok: true, text };
}

export function isValidReferenceDataUrl(imageData: string): boolean {
  if (imageData.length > MAX_REFERENCE_BYTES * 4 / 3 + 128) return false;
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(imageData);
  if (!match) return false;
  const decodedBytes = Buffer.from(match[2] ?? "", "base64").byteLength;
  return decodedBytes > 0 && decodedBytes <= MAX_REFERENCE_BYTES;
}
