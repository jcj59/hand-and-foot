/**
 * Keeping a seat across a reload.
 *
 * The server issues `SeatCredentials` on join and accepts them back through
 * `resumeSeat`, which is what makes a refresh — or a phone locking itself —
 * recoverable rather than a lost seat. That only works if the token outlives the
 * page, so it is kept in `localStorage`.
 *
 * Everything read back is treated as untrusted input. It is a string the user can
 * edit in devtools, and it survives across versions of this app, so it is checked
 * field by field rather than cast. A malformed entry is indistinguishable from no
 * entry, which is the safe reading: the worst case is being asked for a name
 * again, and the server rejects a token it did not issue anyway.
 */
import type { SeatCredentials } from "@hf/shared";

export const CREDENTIALS_KEY = "hf.seat";

/** The slice of the Storage API this uses, so a test can pass an object literal. */
export interface CredentialStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * `localStorage` is not always reachable: a browser set to block site data
 * throws on the *property access* itself, not merely on read, so even asking for
 * it has to be guarded. A session that cannot persist still plays fine — it just
 * cannot recover a seat after a reload — so this degrades rather than failing.
 */
export function browserStore(): CredentialStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isCredentials(value: unknown): value is SeatCredentials {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.roomId === "string" &&
    candidate.roomId !== "" &&
    typeof candidate.token === "string" &&
    candidate.token !== "" &&
    typeof candidate.seat === "number" &&
    Number.isInteger(candidate.seat) &&
    candidate.seat >= 0
  );
}

export function loadCredentials(
  store: CredentialStore | null = browserStore(),
): SeatCredentials | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(CREDENTIALS_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // Field by field: a stored shape from an older version of this app, or one
    // edited by hand, must not become a half-populated credentials object.
    if (!isCredentials(parsed)) return null;
    return { roomId: parsed.roomId, seat: parsed.seat, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveCredentials(
  credentials: SeatCredentials,
  store: CredentialStore | null = browserStore(),
): void {
  try {
    store?.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch {
    // A full or read-only store costs the reload-recovery, nothing more.
  }
}

export function clearCredentials(store: CredentialStore | null = browserStore()): void {
  try {
    store?.removeItem(CREDENTIALS_KEY);
  } catch {
    // Nothing to do: the caller is leaving the table either way.
  }
}
