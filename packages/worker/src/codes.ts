import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@hf/shared";

/**
 * A fresh table code, from the alphabet with no look-alike characters. Each code
 * is its own Durable Object, so a clash is found by asking that object whether it
 * is in use — see `TableObject.open` — rather than by keeping a list of codes.
 */
export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join("");
}
