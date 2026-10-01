/**
 * This browser's identity: a random user id and secret, made up on the first visit
 * and kept in local storage, plus the name the player last went by.
 *
 * It is registered with the server whenever the player sits down, which both
 * creates it the first time and confirms it after. Nothing here can fail in a way
 * the player sees: storage that is blocked or cleared just means a fresh identity,
 * an identity the server says belongs to someone else is replaced by a new one, and
 * a server that cannot be reached means sitting down without one this time.
 */
import {
  IDENTITY_TAKEN,
  isUserCredentials,
  normalizeName,
  parseTransferCode,
  UNKNOWN_IDENTITY,
  USERS_PATH,
  type Ack,
  type UserCredentials,
} from "@hf/shared";

export const IDENTITY_KEY = "hf.identity";
export const NAME_KEY = "hf.name";
/** How long sitting down waits for the identity to be registered before going without. */
export const REGISTER_TIMEOUT_MS = 4_000;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
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
      identity = newIdentity();
      saveIdentity(identity);
      answer = await post(USERS_PATH, { ...identity, name });
    }
    return answer.ok ? identity : null;
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
  try {
    const answer = await post(USERS_PATH, { ...identity, existing: true });
    if (!answer.ok) {
      const unknown = answer.error === UNKNOWN_IDENTITY || answer.error === IDENTITY_TAKEN;
      return {
        ok: false,
        error: unknown
          ? "that code is not a known identity"
          : "could not check that code; try again",
      };
    }
  } catch {
    return { ok: false, error: "could not reach the server; try again" };
  }
  saveIdentity(identity);
  return { ok: true, data: identity };
}
