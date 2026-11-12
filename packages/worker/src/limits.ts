/**
 * A cap on how often one identity may read its history and replays, checked in
 * the Worker before any Durable Object is asked.
 *
 * The Workers free plan allows 100,000 Durable Object requests a day for the whole
 * game, and each history or replay read is one request to the player's identity
 * object. A client bug that re-asks in a loop once spent the day's allowance in
 * two hours and took every table down with it. The client keeps its history for a
 * minute so that should not happen again; this is the backstop for when something
 * still does, so that one tab can cost at most `READ_LIMIT` object requests a
 * minute however it misbehaves. A refused read is answered here, so it costs a
 * Worker request (also 100,000 a day, but a far cheaper failure) and no object
 * request at all.
 *
 * The count lives in the Worker isolate's memory: no object, no storage, nothing
 * that itself spends the quota. Cloudflare runs many isolates, so a determined
 * caller spread across them gets more; a loop in one browser tab, the case this
 * is for, keeps landing on the same one. Cloudflare's rate limiting binding would
 * share counts within a location, but it needs a namespace configured by hand,
 * and an isolate's own count is enough for a family's few tabs.
 */

/** Reads of history and replays one identity may make a minute. */
export const READ_LIMIT = 30;
export const READ_WINDOW_MS = 60_000;
/**
 * What a refused read says, for the client to show as it shows any refusal. Kept
 * here, not in `index.ts`: the Worker's entry module may export only handlers and
 * Durable Object classes, or workerd refuses to start it.
 */
export const TOO_MANY_READS = "too many requests; try again in a minute";
/** Identities counted at once, so a flood of made-up ids cannot grow memory without end. */
export const MAX_COUNTED = 10_000;

interface Count {
  /** When this window began. */
  readonly start: number;
  count: number;
}

/** A fixed-window count per key: `limit` takes every `windowMs`, then a wait. */
export class RateLimiter {
  private readonly windows = new Map<string, Count>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = MAX_COUNTED,
  ) {}

  /**
   * Count one take for `key` at `now`: null if it is allowed, otherwise how many
   * whole seconds until the key's window ends and it may try again.
   */
  take(key: string, now: number): number | null {
    let window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs || now < window.start) {
      this.windows.delete(key);
      this.makeRoom(now);
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count++;
    if (window.count <= this.limit) return null;
    // At least 1: the window has not ended, so some of it is left.
    return Math.ceil((window.start + this.windowMs - now) / 1000);
  }

  /** How many keys are being counted. */
  get size(): number {
    return this.windows.size;
  }

  /** Before counting a new key at the cap: drop ended windows, else the oldest. */
  private makeRoom(now: number): void {
    if (this.windows.size < this.maxKeys) return;
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
    // Insertion order is the order the windows began, so the first is the oldest.
    if (this.windows.size >= this.maxKeys) {
      this.windows.delete(this.windows.keys().next().value!);
    }
  }
}
