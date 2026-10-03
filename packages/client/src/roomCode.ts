/**
 * Reading a room code the way a person types it.
 *
 * Codes are read off a shared link, or heard across a room and typed in, so the
 * input forgives the things people do: lower case, a space or dash in the middle,
 * trailing whitespace from a paste.
 *
 * What it will not do is guess. The server's alphabet deliberately omits every
 * character people confuse — no O or 0, no I, 1 or L — which means a typed `0` has
 * no unambiguous character to be corrected to, because `O` is not in the alphabet
 * either. Mapping it to something would risk sending a player to a different real
 * table, so an impossible character makes the code invalid and the player is asked
 * to check it.
 */
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@hf/shared";

/** Upper-case it and drop the separators a person might type or paste. */
export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Whether this could be a real code, so the interface can refuse to spend a round
 * trip on something that certainly is not one. A `true` here is not a promise that
 * the table exists — only the server knows that.
 */
export function isPossibleRoomCode(raw: string): boolean {
  const code = normalizeRoomCode(raw);
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
}

/**
 * The link to send someone. Built from the running origin rather than a configured
 * base URL, so it is right in development, in a preview deployment and in
 * production without anything to keep in step.
 */
export function roomLink(roomId: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/room/${normalizeRoomCode(roomId)}`;
}

/** The link to watch a table without a seat at it. */
export function watchLink(roomId: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/watch/${normalizeRoomCode(roomId)}`;
}
