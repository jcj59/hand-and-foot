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

/** Whether a value is shaped like a user id, so it may name where an identity is kept. */
export function isUserId(value: unknown): value is string {
  return typeof value === "string" && USER_ID.test(value);
}

/** Whether an untyped value is a well-formed pair of credentials. */
export function isUserCredentials(value: unknown): value is UserCredentials {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isUserId(v.userId) && typeof v.secret === "string" && SECRET.test(v.secret);
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

// Signing in: a username and password attached to an identity, so the same player
// can be had on a device that never held its code. The identity is still the
// player; the username is only how to find it again. Each device signed in gets a
// secret of its own, so changing the password can sign every other device out.

/** Give this identity a username and password: POST `{ user, username, password }`. */
export const CLAIM_PATH = "/api/account/claim";
/** Sign this device in: POST `{ username, password, name? }`, answered with fresh credentials. */
export const SIGN_IN_PATH = "/api/account/sign-in";
/** Change the password and sign every other device out: POST `{ user, password, newPassword }`. */
export const PASSWORD_PATH = "/api/account/password";
/** Forget this device's secret: POST `{ user }`. */
export const SIGN_OUT_PATH = "/api/account/sign-out";

/** What a device learns on signing in: credentials of its own, and who it now is. */
export interface SignedIn extends UserCredentials {
  readonly username: string;
  readonly name: string;
}

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 24;
export const MIN_PASSWORD_LENGTH = 8;
/** Long enough for any passphrase, short enough that hashing one is never the expensive part. */
export const MAX_PASSWORD_LENGTH = 128;

export const BAD_USERNAME = `a username is ${MIN_USERNAME_LENGTH} to ${MAX_USERNAME_LENGTH} letters, digits, dots, dashes or underscores`;
export const BAD_PASSWORD = `a password is ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`;
export const USERNAME_TAKEN = "that username is taken";
export const ALREADY_CLAIMED = "this profile already has a username";
export const NOT_CLAIMED = "this profile has no username yet";
/** Deliberately one answer for both a wrong password and no such username. */
export const WRONG_PASSWORD = "that username and password do not match";
export const TOO_MANY_TRIES = "too many wrong passwords; wait a few minutes and try again";
export const TRY_AGAIN = "someone else changed this profile at the same moment; try again";

const USERNAME = new RegExp(`^[A-Za-z0-9._-]{${MIN_USERNAME_LENGTH},${MAX_USERNAME_LENGTH}}$`);

/** A username as typed, trimmed, or null if it is not one. Case is kept for showing it. */
export function parseUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return USERNAME.test(trimmed) ? trimmed : null;
}

/** What a username is looked up by: nobody types its case the same way twice. */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}

/** Whether a value is acceptable as a password. Never trimmed: every character counts. */
export function isPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}
