/**
 * Identities: who a player is across tables, with no account behind it.
 *
 * A browser registers a random user id with a random secret, and proves it is the
 * same browser later by presenting both. The server keeps only a hash of the
 * secret, so the store is no use to anyone who reads it. Registering an id that is
 * already taken with the wrong secret is refused; the client then makes itself a
 * new identity, which is also what happens when someone clears their storage — a
 * fresh start, never an error the player has to deal with.
 *
 * An identity may be held by several devices, each with a secret of its own: the
 * one that made it, and every one signed in to it since (`accounts.ts`). Keeping
 * them apart is what lets one device be signed out without the others.
 *
 * An identity says who someone is, never what they may do: the seat token is
 * still the only thing that lets a connection act at a table.
 */
import {
  IDENTITY_TAKEN,
  isUserCredentials,
  normalizeName,
  NOT_AN_IDENTITY,
  TRY_AGAIN,
  UNKNOWN_IDENTITY,
  type Ack,
  type UserCredentials,
} from "@hf/shared";

export { IDENTITY_TAKEN, NOT_AN_IDENTITY, UNKNOWN_IDENTITY };

export interface UserRecord {
  readonly userId: string;
  /**
   * SHA-256 of each device's secret, hex, oldest first. The secrets themselves are
   * never stored.
   */
  readonly devices: readonly string[];
  /** The name last used, so it can be offered again. */
  readonly name: string;
  /** The username this identity can be signed in to by, once it has one. */
  readonly username: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * One more than the version it replaces, and 1 for a new identity: a write is
   * refused unless the record it was made from is still the one stored.
   */
  readonly version: number;
}

/** The most devices one identity keeps; signing in another forgets the oldest. */
export const MAX_DEVICES = 20;

export interface UserStore {
  get(userId: string): Promise<UserRecord | null>;
  /**
   * Write the record if the one stored is the version before it (none, for version
   * 1) — checked in the same step as the write, so two requests changing one
   * identity at once cannot both win. Resolves whether it was written.
   */
  put(record: UserRecord): Promise<boolean>;
}

/** A record as it was first stored, before devices and versions: one secret, no username. */
interface LegacyUserRecord {
  readonly userId: string;
  readonly secretHash: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * A stored record in today's shape, whichever shape it was written in. An old one
 * counts as version 1, as if it had been written new today, which is what the
 * Postgres migration gives its rows too.
 */
export function upgradeUserRecord(stored: UserRecord | LegacyUserRecord): UserRecord {
  if ("devices" in stored) return stored;
  const { secretHash, ...rest } = stored;
  return { ...rest, devices: [secretHash], username: null, version: 1 };
}

/** Whether `record` may replace `held` (nothing, for a new identity). */
export function follows(
  record: { readonly version: number },
  held: { readonly version: number } | null,
): boolean {
  return record.version === (held ? held.version + 1 : 1);
}

export class InMemoryUserStore implements UserStore {
  private readonly records = new Map<string, UserRecord>();
  async get(userId: string): Promise<UserRecord | null> {
    return this.records.get(userId) ?? null;
  }
  async put(record: UserRecord): Promise<boolean> {
    if (!follows(record, this.records.get(record.userId) ?? null)) return false;
    this.records.set(record.userId, record);
    return true;
  }
}

/** SHA-256 of a secret, as hex. Web Crypto, so it runs the same in Node and in a Worker. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** How many times a change is tried again after losing a race to another one. */
const ATTEMPTS = 3;

/**
 * Change one identity: read it, let `change` decide, and write the result, starting
 * again from a fresh read if something else wrote in between. `change` answers a
 * refusal, `null` for nothing to write, or the fields to change; the version and
 * `updatedAt` are filled in here.
 */
export async function changeUser<T>(
  store: UserStore,
  userId: string,
  now: number,
  change: (
    held: UserRecord | null,
  ) => Ack<T> | { readonly write: Partial<UserRecord>; readonly then: T },
): Promise<Ack<T>> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const held = await store.get(userId);
    const decided = change(held);
    if (!("write" in decided)) return decided;
    const record: UserRecord = {
      userId,
      devices: [],
      name: "",
      username: null,
      createdAt: now,
      ...held,
      ...decided.write,
      updatedAt: now,
      version: held ? held.version + 1 : 1,
    };
    if (await store.put(record)) return { ok: true, data: decided.then };
  }
  return { ok: false, error: TRY_AGAIN };
}

/** What a registration answers: who the identity is now. */
export interface Registered {
  readonly userId: string;
  readonly name: string;
  /** Its username, so a device moved here by code learns it is signed in. */
  readonly username: string | null;
}

/**
 * Register an identity, or confirm one and remember the name it now goes by. The
 * body is untyped JSON from a browser: `{ userId, secret, name }`, with `existing:
 * true` when the identity must already be known — moving one to another device,
 * where a mistyped code must be refused rather than become a new identity.
 */
export async function registerUser(
  store: UserStore,
  body: unknown,
  now: number,
): Promise<Ack<Registered>> {
  if (!isUserCredentials(body)) return { ok: false, error: NOT_AN_IDENTITY };
  const name = normalizeName((body as { name?: unknown }).name);
  const mustExist = (body as { existing?: unknown }).existing === true;
  const secretHash = await hashSecret(body.secret);
  return changeUser<Registered>(store, body.userId, now, (held) => {
    // Comparing hashes rather than secrets: what an attacker controls is the
    // secret, and its hash gives away nothing through how long a comparison takes.
    if (held && !held.devices.includes(secretHash)) return { ok: false, error: IDENTITY_TAKEN };
    if (!held && mustExist) return { ok: false, error: UNKNOWN_IDENTITY };
    const kept = name || held?.name || "";
    return {
      write: held ? { name: kept } : { devices: [secretHash], name: kept },
      then: { userId: body.userId, name: kept, username: held?.username ?? null },
    };
  });
}

/**
 * The record these credentials prove, or null — for anything that is not a
 * registered identity with this device's secret among its own.
 */
export async function provenUser(
  store: UserStore,
  credentials: unknown,
): Promise<{ readonly record: UserRecord; readonly secretHash: string } | null> {
  if (!isUserCredentials(credentials)) return null;
  const record = await store.get(credentials.userId);
  if (!record) return null;
  const secretHash = await hashSecret(credentials.secret);
  return record.devices.includes(secretHash) ? { record, secretHash } : null;
}

/**
 * The user id these credentials prove, or null. Sitting down with credentials that
 * do not check out seats the player anyway, just without an identity: a table is
 * never refused over this.
 */
export async function verifyUser(store: UserStore, credentials: unknown): Promise<string | null> {
  try {
    return (await provenUser(store, credentials))?.record.userId ?? null;
  } catch {
    // A store that cannot answer — a database blip — is no reason to refuse a seat:
    // the player sits down without an identity this time.
    return null;
  }
}

export type { UserCredentials };
