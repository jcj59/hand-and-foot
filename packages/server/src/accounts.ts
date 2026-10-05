/**
 * Signing in: a username and password that lead back to an identity.
 *
 * An identity starts anonymous (`users.ts`) and may later be given a username and
 * password, from a device that already holds it. Another device then signs in with
 * those and is given a secret of its own for the same identity, so nothing about
 * the player — their history, their stats — has to move. Changing the password
 * keeps only the device that changed it; signing out forgets just the one device.
 *
 * There is no recovery. A family game has no email to send a reset to, and a
 * device still signed in can always change the password, so a forgotten one costs
 * nothing until every device is signed out.
 *
 * The username lives in a store of its own, keyed by its lower-case form, because
 * that is the one lookup that is not by user id. Two stores cannot be written in
 * one step everywhere these rules run, so a username is claimed first and then
 * recorded on the identity, and a claim that loses a race on the identity is
 * given back.
 */
import {
  ALREADY_CLAIMED,
  BAD_PASSWORD,
  BAD_USERNAME,
  isPassword,
  isUserCredentials,
  normalizeName,
  NOT_AN_IDENTITY,
  NOT_CLAIMED,
  parseUsername,
  TOO_MANY_TRIES,
  TRY_AGAIN,
  USERNAME_TAKEN,
  usernameKey,
  WRONG_PASSWORD,
  type Ack,
  type SignedIn,
} from "@hf/shared";
import { changeUser, follows, hashSecret, MAX_DEVICES, provenUser, type UserStore } from "./users";

export interface LoginRecord {
  /** The username in lower case, which is what it is found by. */
  readonly key: string;
  /** The username as it was chosen. */
  readonly username: string;
  readonly userId: string;
  /** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, salt and hash in base64. */
  readonly passwordHash: string;
  /** Wrong passwords since the last right one. */
  readonly failures: number;
  /** No password is checked before this time; 0 when not locked. */
  readonly lockedUntil: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** As for identities: one more than the version it replaces, 1 when new. */
  readonly version: number;
}

export interface LoginStore {
  get(key: string): Promise<LoginRecord | null>;
  /** Write if the stored record is the version before (none, for version 1). Resolves whether it was written. */
  put(record: LoginRecord): Promise<boolean>;
  /** Give a username back, if it still leads to this identity. */
  delete(key: string, userId: string): Promise<void>;
}

export class InMemoryLoginStore implements LoginStore {
  private readonly records = new Map<string, LoginRecord>();
  async get(key: string): Promise<LoginRecord | null> {
    return this.records.get(key) ?? null;
  }
  async put(record: LoginRecord): Promise<boolean> {
    if (!follows(record, this.records.get(record.key) ?? null)) return false;
    this.records.set(record.key, record);
    return true;
  }
  async delete(key: string, userId: string): Promise<void> {
    if (this.records.get(key)?.userId === userId) this.records.delete(key);
  }
}

export interface AccountStores {
  readonly users: UserStore;
  readonly logins: LoginStore;
}

/**
 * PBKDF2 rounds for a new password. Fewer than the usual advice, deliberately: a
 * Worker on the free plan has 10ms of CPU for a request, and 50,000 rounds take
 * about 5ms. Guessing online is held back by the lock below, so the rounds only
 * matter to someone who has read the store; the count is kept with each hash, so
 * it can be raised without anyone's password breaking.
 */
export const PASSWORD_ROUNDS = 50_000;

/** Wrong passwords allowed before the username is locked for a while. */
export const FREE_TRIES = 5;
/** The first lock; each further wrong password doubles it, up to `MAX_LOCK_MS`. */
export const FIRST_LOCK_MS = 60_000;
export const MAX_LOCK_MS = 60 * 60_000;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  rounds: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** A salted hash of a password, with what it takes to check one against it. */
export async function hashPassword(password: string, rounds = PASSWORD_ROUNDS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${rounds}$${toBase64(salt)}$${toBase64(await derive(password, salt, rounds))}`;
}

/** Whether a password is the one a stored hash was made from. */
export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, rounds, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !rounds || !salt || !hash) return false;
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    expected = fromBase64(hash);
    actual = await derive(password, fromBase64(salt), Number(rounds));
  } catch {
    // Not base64, or a count PBKDF2 will not take: no password matches it.
    return false;
  }
  if (expected.length !== actual.length) return false;
  // Every byte compared, whatever the first difference: how long this takes says
  // nothing about how close a guess was.
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ actual[i]!;
  return difference === 0;
}

/**
 * Checked against a username nobody has, so that one that does not exist takes as
 * long to refuse as a wrong password does.
 */
let decoy: Promise<string> | null = null;

/** A new device's secret, from the same alphabet and of the same length a browser makes its own. */
export function newSecret(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return [...crypto.getRandomValues(new Uint8Array(43))].map((b) => alphabet[b & 63]).join("");
}

/** How long a username is locked after its `failures`-th wrong password in a row. */
export function lockFor(failures: number): number {
  if (failures < FREE_TRIES) return 0;
  return Math.min(FIRST_LOCK_MS * 2 ** (failures - FREE_TRIES), MAX_LOCK_MS);
}

/**
 * Check a password for a username, counting a wrong one towards the lock and
 * clearing the count on a right one. Resolves the login it opened, or a refusal.
 */
async function unlock(
  logins: LoginStore,
  login: LoginRecord,
  password: unknown,
  now: number,
): Promise<Ack<LoginRecord>> {
  if (login.lockedUntil > now) return { ok: false, error: TOO_MANY_TRIES };
  // No length limit here: PBKDF2 hashes a long password down first, so one costs
  // no more to check than a short one, and the request body is capped anyway.
  const right = typeof password === "string" && (await checkPassword(password, login.passwordHash));
  if (right && login.failures === 0) return { ok: true, data: login };
  // Written whatever happened, and read again when it loses a race, so that every
  // wrong guess counts even when several arrive at once.
  for (let current: LoginRecord | null = login, attempt = 0; current && attempt < 3; attempt++) {
    const failures = right ? 0 : current.failures + 1;
    const next: LoginRecord = {
      ...current,
      failures,
      lockedUntil: right ? 0 : now + lockFor(failures),
      updatedAt: now,
      version: current.version + 1,
    };
    if (await logins.put(next)) {
      return right ? { ok: true, data: next } : { ok: false, error: WRONG_PASSWORD };
    }
    current = await logins.get(login.key);
  }
  return { ok: false, error: right ? TRY_AGAIN : WRONG_PASSWORD };
}

/**
 * Give an identity a username and password, from a device that holds it:
 * `{ user, username, password }`. The username is claimed before the identity
 * records it; if the identity has meanwhile been given another, this one is given
 * back.
 */
export async function claimUsername(
  { users, logins }: AccountStores,
  body: Record<string, unknown>,
  now: number,
): Promise<Ack<{ readonly username: string }>> {
  const proven = await provenUser(users, body.user);
  if (!proven) return { ok: false, error: NOT_AN_IDENTITY };
  const { userId } = proven.record;
  if (proven.record.username !== null) return { ok: false, error: ALREADY_CLAIMED };
  const username = parseUsername(body.username);
  if (username === null) return { ok: false, error: BAD_USERNAME };
  if (!isPassword(body.password)) return { ok: false, error: BAD_PASSWORD };

  const key = usernameKey(username);
  const login: LoginRecord = {
    key,
    username,
    userId,
    passwordHash: await hashPassword(body.password),
    failures: 0,
    lockedUntil: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  if (!(await logins.put(login))) return { ok: false, error: USERNAME_TAKEN };

  const recorded = await changeUser<{ readonly username: string }>(users, userId, now, (held) => {
    if (!held) return { ok: false, error: NOT_AN_IDENTITY };
    if (held.username !== null) return { ok: false, error: ALREADY_CLAIMED };
    return { write: { username }, then: { username } };
  });
  if (!recorded.ok) await logins.delete(key, userId);
  return recorded;
}

/**
 * Sign a device in: `{ username, password, name? }`. A right password adds a new
 * secret to the identity and answers it; this device never learns another's.
 */
export async function signIn(
  { users, logins }: AccountStores,
  body: Record<string, unknown>,
  now: number,
): Promise<Ack<SignedIn>> {
  const username = parseUsername(body.username);
  const login = username === null ? null : await logins.get(usernameKey(username));
  if (!login) {
    decoy ??= hashPassword("not anyone's password");
    if (typeof body.password === "string") {
      await checkPassword(body.password, await decoy);
    }
    return { ok: false, error: WRONG_PASSWORD };
  }
  const opened = await unlock(logins, login, body.password, now);
  if (!opened.ok) return opened;

  const secret = newSecret();
  const secretHash = await hashSecret(secret);
  const name = normalizeName(body.name);
  return changeUser<SignedIn>(users, login.userId, now, (held) => {
    // A username whose identity is gone leads nowhere; it cannot happen through
    // these rules, and is answered as if the username did not exist.
    if (!held || held.username === null) return { ok: false, error: WRONG_PASSWORD };
    const kept = name || held.name;
    return {
      write: { devices: [...held.devices, secretHash].slice(-MAX_DEVICES), name: kept },
      then: { userId: held.userId, secret, username: held.username, name: kept },
    };
  });
}

/**
 * Change the password, from a device signed in to the identity, knowing the
 * current one: `{ user, password, newPassword }`. Every other device is signed out.
 */
export async function changePassword(
  { users, logins }: AccountStores,
  body: Record<string, unknown>,
  now: number,
): Promise<Ack<null>> {
  const proven = await provenUser(users, body.user);
  if (!proven) return { ok: false, error: NOT_AN_IDENTITY };
  const { record, secretHash } = proven;
  const login = record.username === null ? null : await logins.get(usernameKey(record.username));
  if (!login || login.userId !== record.userId) return { ok: false, error: NOT_CLAIMED };
  if (!isPassword(body.newPassword)) return { ok: false, error: BAD_PASSWORD };
  const opened = await unlock(logins, login, body.password, now);
  if (!opened.ok) return opened;

  const changed: LoginRecord = {
    ...opened.data,
    passwordHash: await hashPassword(body.newPassword),
    updatedAt: now,
    version: opened.data.version + 1,
  };
  if (!(await logins.put(changed))) return { ok: false, error: TRY_AGAIN };
  return changeUser<null>(users, record.userId, now, (held) => {
    if (!held || !held.devices.includes(secretHash)) return { ok: false, error: NOT_AN_IDENTITY };
    return { write: { devices: [secretHash] }, then: null };
  });
}

/** Forget this device's secret: `{ user }`. Nothing to forget is not a failure. */
export async function signOut(
  { users }: AccountStores,
  body: Record<string, unknown>,
  now: number,
): Promise<Ack<null>> {
  if (!isUserCredentials(body.user)) return { ok: true, data: null };
  const secretHash = await hashSecret(body.user.secret);
  return changeUser<null>(users, body.user.userId, now, (held) => {
    if (!held?.devices.includes(secretHash)) return { ok: true, data: null };
    return { write: { devices: held.devices.filter((d) => d !== secretHash) }, then: null };
  });
}
