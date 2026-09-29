/**
 * Turning the server's absolute deadlines into a countdown this browser can render.
 *
 * Every `ClockState` carries `serverNow` and an absolute `deadlineAt` rather than
 * a remaining-milliseconds figure, and the protocol says why: a remaining figure
 * is stale the moment it is sent, so a client that rendered it would drift a
 * little further on every update. Instead the client measures the offset between
 * the two clocks once and reads deadlines through it.
 *
 * Re-anchoring on every update would undo the point. Network latency varies, so
 * the computed offset wobbles by tens of milliseconds each time, and a countdown
 * rebuilt from it would visibly stutter. So the offset is kept until it is
 * provably wrong, which is what `RESYNC_THRESHOLD_MS` decides.
 */

/**
 * How far the estimate may be out before the offset is rebuilt.
 *
 * A laptop that slept, a tab the browser throttled, or a clock the OS stepped
 * all leave the offset genuinely wrong rather than merely jittery, and a turn
 * clock that reads minutes off is worse than one that stutters once. Two seconds
 * is comfortably above normal latency variation and far below any turn timer.
 */
export const RESYNC_THRESHOLD_MS = 2_000;

export interface ServerClock {
  /**
   * Take a server timestamp. The first one sets the offset; later ones are used
   * only to notice that it has become wrong.
   */
  anchor(serverNow: number): void;
  /** This browser's best estimate of the server's clock. */
  now(): number;
  /**
   * Milliseconds left until an absolute server deadline: null when there is no
   * deadline (the table is paused, or the game has not started), and never
   * negative, because "overdue by 4s" is not something a turn timer should show.
   */
  remaining(deadlineAt: number | null): number | null;
  /**
   * A server timestamp as this browser's clock would read it, for showing a time
   * of day: the server's half past three is not half past three here if the two
   * clocks disagree.
   */
  toLocal(serverAt: number): number;
  /** Whether a server timestamp has been seen yet. */
  readonly anchored: boolean;
  /** The current offset, exposed for assertions and debugging. */
  readonly offsetMs: number;
}

/**
 * `now` is injected for the same reason the server injects its `Clock`: a test
 * that has to sleep to check a countdown is slow and flaky.
 */
export function createServerClock(now: () => number = Date.now): ServerClock {
  let offsetMs = 0;
  let anchored = false;

  return {
    get anchored() {
      return anchored;
    },
    get offsetMs() {
      return offsetMs;
    },

    anchor(serverNow: number): void {
      // One-way network latency is ignored on purpose. It biases the offset by
      // the trip time, which is tens of milliseconds against turn clocks measured
      // in tens of seconds, and correcting it properly needs a round-trip probe
      // the protocol does not have.
      const candidate = serverNow - now();
      if (!anchored) {
        offsetMs = candidate;
        anchored = true;
        return;
      }
      if (Math.abs(candidate - offsetMs) >= RESYNC_THRESHOLD_MS) offsetMs = candidate;
    },

    now(): number {
      return now() + offsetMs;
    },

    remaining(deadlineAt: number | null): number | null {
      if (deadlineAt === null) return null;
      return Math.max(0, deadlineAt - (now() + offsetMs));
    },

    toLocal(serverAt: number): number {
      return serverAt - offsetMs;
    },
  };
}
