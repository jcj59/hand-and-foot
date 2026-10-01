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
 * An identity says who someone is, never what they may do: the seat token is
 * still the only thing that lets a connection act at a table.
 */
import {
  IDENTITY_TAKEN,
  isUserCredentials,
  normalizeName,
  NOT_AN_IDENTITY,
  UNKNOWN_IDENTITY,
  type Ack,
  type UserCredentials,
} from "@hf/shared";

export { IDENTITY_TAKEN, NOT_AN_IDENTITY, UNKNOWN_IDENTITY };

export interface UserRecord {
  readonly userId: string;
  /** SHA-256 of the secret, hex. The secret itself is never stored. */
  readonly secretHash: string;
  /** The name last used, so it can be offered again. */
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface UserStore {
  get(userId: string): Promise<UserRecord | null>;
  /**
   * Write the record, unless the id is already held under a different secret —
   * checked in the same step as the write, so two browsers registering one id at
   * once cannot both win. Resolves whether it was written.
   */
  put(record: UserRecord): Promise<boolean>;
}

export class InMemoryUserStore implements UserStore {
  private readonly records = new Map<string, UserRecord>();
  async get(userId: string): Promise<UserRecord | null> {
    return this.records.get(userId) ?? null;
  }
  async put(record: UserRecord): Promise<boolean> {
    const held = this.records.get(record.userId);
    if (held && held.secretHash !== record.secretHash) return false;
    this.records.set(record.userId, record);
    return true;
  }
}

/** SHA-256 of a secret, as hex. Web Crypto, so it runs the same in Node and in a Worker. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
): Promise<Ack<{ readonly userId: string; readonly name: string }>> {
  if (!isUserCredentials(body)) return { ok: false, error: NOT_AN_IDENTITY };
  const name = normalizeName((body as { name?: unknown }).name);
  const secretHash = await hashSecret(body.secret);
  const existing = await store.get(body.userId);
  // Comparing hashes rather than secrets: what an attacker controls is the secret,
  // and its hash gives away nothing through how long a comparison takes.
  if (existing && existing.secretHash !== secretHash) return { ok: false, error: IDENTITY_TAKEN };
  if (!existing && (body as { existing?: unknown }).existing === true) {
    return { ok: false, error: UNKNOWN_IDENTITY };
  }
  const record: UserRecord = {
    userId: body.userId,
    secretHash,
    name: name || existing?.name || "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Someone else registered this id between the read and the write.
  if (!(await store.put(record))) return { ok: false, error: IDENTITY_TAKEN };
  return { ok: true, data: { userId: record.userId, name: record.name } };
}

/**
 * The user id these credentials prove, or null — for anything that is not a
 * registered identity with its own secret. Sitting down with credentials that do
 * not check out seats the player anyway, just without an identity: a table is
 * never refused over this.
 */
export async function verifyUser(store: UserStore, credentials: unknown): Promise<string | null> {
  if (!isUserCredentials(credentials)) return null;
  try {
    const existing = await store.get(credentials.userId);
    if (!existing) return null;
    return existing.secretHash === (await hashSecret(credentials.secret)) ? existing.userId : null;
  } catch {
    // A store that cannot answer — a database blip — is no reason to refuse a seat:
    // the player sits down without an identity this time.
    return null;
  }
}

export type { UserCredentials };
