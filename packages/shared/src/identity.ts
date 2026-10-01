// Who a player is, across tables and visits, without an account.
//
// A browser makes up an identity the first time it is used — a random user id and
// a random secret, kept in its own storage — and registers it with the server.
// Presenting both again proves it is the same browser (or one the identity was
// moved to). That is all an identity is: a name for a person, so that later
// features can say "Ana has won six games". It is not permission to do anything at
// a table. Acting at a table is what a seat token is for, and an identity never
// stands in for one.

/** What a browser holds to say who it is. The secret never leaves it except to prove that. */
export interface UserCredentials {
  readonly userId: string;
  readonly secret: string;
}

/** Register an identity, or confirm one and update its name: POST `{ userId, secret, name }`. */
export const USERS_PATH = "/api/users";

/** The server's refusals of a registration, which the client tells apart. */
export const NOT_AN_IDENTITY = "that is not an identity";
export const IDENTITY_TAKEN = "that identity belongs to another browser";
export const UNKNOWN_IDENTITY = "there is no such identity";

/**
 * Generated ids and secrets are long random strings from this alphabet; anything
 * else is refused before it reaches storage.
 */
const USER_ID = /^[A-Za-z0-9_-]{16,64}$/;
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;

/** Whether an untyped value is a well-formed pair of credentials. */
export function isUserCredentials(value: unknown): value is UserCredentials {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    USER_ID.test(v.userId) &&
    typeof v.secret === "string" &&
    SECRET.test(v.secret)
  );
}

/** The longest name a player can go by. */
export const MAX_NAME_LENGTH = 24;

/** A name as the server keeps it: trimmed, inner runs of space collapsed, and capped. */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LENGTH);
}

/**
 * How an identity is moved to another device: the two halves in one string to
 * copy and paste. It is the whole identity, so it is shown only to its owner.
 */
export function transferCode(credentials: UserCredentials): string {
  return `hf1.${credentials.userId}.${credentials.secret}`;
}

/** Read a transfer code back, or null if it is not one. */
export function parseTransferCode(code: string): UserCredentials | null {
  const parts = code.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "hf1") return null;
  const credentials = { userId: parts[1]!, secret: parts[2]! };
  return isUserCredentials(credentials) ? credentials : null;
}
