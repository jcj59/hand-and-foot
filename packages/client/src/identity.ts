/**
 * This browser's identity: a random user id and secret, made up on the first visit
 * and kept in local storage, plus the name the player last went by, and the
 * username it is signed in under, if it is.
 *
 * It is registered with the server whenever the player sits down, which both
 * creates it the first time and confirms it after. Nothing here can fail in a way
 * the player sees: storage that is blocked or cleared just means a fresh identity,
 * an identity the server says belongs to someone else is replaced by a new one, and
 * a server that cannot be reached means sitting down without one this time.
 */
import {
  CLAIM_PATH,
  IDENTITY_TAKEN,
  isUserCredentials,
  normalizeName,
  parseTransferCode,
  PASSWORD_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  UNKNOWN_IDENTITY,
  USERS_PATH,
  type Ack,
  type SignedIn,
  type UserCredentials,
} from "@hf/shared";

export const IDENTITY_KEY = "hf.identity";
export const NAME_KEY = "hf.name";
/** The username this device is signed in under; absent when it is not. */
export const ACCOUNT_KEY = "hf.account";
const UNREACHABLE = "could not reach the server; try again";
/** How long sitting down waits for the identity to be registered before going without. */
export const REGISTER_TIMEOUT_MS = 4_000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the identity lasts as long as the page.
  }
}

/** A random string from the URL-safe alphabet the server accepts. */
export function randomToken(
  length: number,
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // 64 symbols: each byte's low six bits pick one with no bias.
  return [...random(new Uint8Array(length))].map((b) => alphabet[b & 63]).join("");
}

export function newIdentity(): UserCredentials {
  return { userId: randomToken(22), secret: randomToken(43) };
}

/** The identity this browser holds, or null when it has none or the stored one is damaged. */
export function loadIdentity(): UserCredentials | null {
  const raw = read(IDENTITY_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isUserCredentials(parsed) ? { userId: parsed.userId, secret: parsed.secret } : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: UserCredentials): void {
  write(IDENTITY_KEY, JSON.stringify(identity));
}

/** This browser's identity, made and kept now if it had none. */
export function ensureIdentity(): UserCredentials {
  const existing = loadIdentity();
  if (existing) return existing;
  const made = newIdentity();
  saveIdentity(made);
  return made;
}

/** The name the player last sat down as, to offer again. */
export function loadName(): string {
  return normalizeName(read(NAME_KEY));
}

export function rememberName(name: string): void {
  write(NAME_KEY, normalizeName(name));
}

/**
 * The username this device is signed in under, or null. Only a label: what proves
 * who the player is stays the identity, and the server is asked again whenever the
 * identity is registered, so a device signed out elsewhere learns it then.
 */
export function loadAccount(): string | null {
  return read(ACCOUNT_KEY) || null;
}

function saveAccount(username: string | null): void {
  write(ACCOUNT_KEY, username);
}

/** Just the part of `fetch` this needs, so tests can answer it. */
export type Post = (url: string, body: unknown) => Promise<Ack<unknown>>;

export function httpPost(base: string): Post {
  return async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Ack<unknown>;
  };
}

/**
 * Register this browser's identity under `name`, and return the credentials to sit
 * down with — or null if the server could not be asked in time, in which case the
 * player sits down without an identity rather than not at all. An identity the
 * server says is someone else's (after storage was copied) is replaced with a fresh
 * one; any other refusal — a server whose store failed — keeps it for next time.
 */
export async function prepareIdentity(
  post: Post,
  name: string,
  timeoutMs = REGISTER_TIMEOUT_MS,
): Promise<UserCredentials | null> {
  const attempt = async (): Promise<UserCredentials | null> => {
    let identity = ensureIdentity();
    let answer = await post(USERS_PATH, { ...identity, name });
    if (!answer.ok && answer.error === IDENTITY_TAKEN) {
      // Signed out from another device, or storage copied from one: start afresh.
      identity = newIdentity();
      saveIdentity(identity);
      saveAccount(null);
      answer = await post(USERS_PATH, { ...identity, name });
    }
    if (!answer.ok) return null;
    saveAccount(usernameIn(answer.data));
    return identity;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([attempt().catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Take on the identity a transfer code carries — moving this player's identity to
 * this device. The server is asked first, so a mistyped or someone else's code is
 * refused with a reason and the current identity is kept.
 */
export async function adoptTransferCode(post: Post, code: string): Promise<Ack<UserCredentials>> {
  const identity = parseTransferCode(code);
  if (!identity) return { ok: false, error: "that is not a transfer code" };
  const answer = await ask(post, USERS_PATH, { ...identity, existing: true });
  if (!answer.ok) {
    const unknown = answer.error === UNKNOWN_IDENTITY || answer.error === IDENTITY_TAKEN;
    const unreachable = answer.error === UNREACHABLE;
    return {
      ok: false,
      error: unknown
        ? "that code is not a known identity"
        : unreachable
          ? UNREACHABLE
          : "could not check that code; try again",
    };
  }
  saveIdentity(identity);
  // A profile with a username comes signed in under it.
  saveAccount(usernameIn(answer.data));
  return { ok: true, data: identity };
}

/** The username a registration answered with, or null for none or an older server's answer. */
function usernameIn(data: unknown): string | null {
  const username = (data as { username?: unknown } | null)?.username;
  return typeof username === "string" ? username : null;
}

/** Ask the server, answering a request that never arrived as one that can be tried again. */
async function ask<T>(post: Post, path: string, body: unknown): Promise<Ack<T>> {
  try {
    return (await post(path, body)) as Ack<T>;
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/**
 * Give this device's profile a username and password, so another device can sign
 * in to it. The profile is registered first, since the server only gives a
 * username to an identity it knows.
 */
export async function claimAccount(
  post: Post,
  username: string,
  password: string,
): Promise<Ack<string>> {
  const identity = await prepareIdentity(post, loadName());
  if (!identity) return { ok: false, error: UNREACHABLE };
  const answer = await ask<{ username: string }>(post, CLAIM_PATH, {
    user: identity,
    username,
    password,
  });
  if (!answer.ok) return answer;
  saveAccount(answer.data.username);
  return { ok: true, data: answer.data.username };
}

/**
 * Sign this device in, so it plays as that profile from now on. The device is
 * given a secret of its own; whatever profile it had before is left behind, with
 * any games played under it.
 */
export async function signIn(
  post: Post,
  username: string,
  password: string,
): Promise<Ack<SignedIn>> {
  const answer = await ask<SignedIn>(post, SIGN_IN_PATH, {
    username,
    password,
    name: loadName(),
  });
  if (!answer.ok) return answer;
  saveIdentity({ userId: answer.data.userId, secret: answer.data.secret });
  saveAccount(answer.data.username);
  if (answer.data.name) rememberName(answer.data.name);
  return answer;
}

/** Change the password from this device, which stays signed in while every other is signed out. */
export async function changePassword(
  post: Post,
  password: string,
  newPassword: string,
): Promise<Ack<null>> {
  const identity = loadIdentity();
  if (!identity) return { ok: false, error: "this device is not signed in" };
  return ask<null>(post, PASSWORD_PATH, { user: identity, password, newPassword });
}

/**
 * Sign this device out: the server forgets its secret, and the device forgets the
 * profile, making a fresh one the next time it needs one. Forgotten here even when
 * the server cannot be told, since a player who signs out means it.
 */
export async function signOut(post: Post): Promise<void> {
  const identity = loadIdentity();
  if (identity) await ask(post, SIGN_OUT_PATH, { user: identity });
  write(IDENTITY_KEY, null);
  saveAccount(null);
}
