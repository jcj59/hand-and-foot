/**
 * Everything that knows what time it is goes through here.
 *
 * The engine is a pure reducer with no clock, which is what makes replay and
 * headless simulation work. That leaves the server as the only component with a
 * notion of "now", and if it reached for `Date.now()` and `setTimeout` directly,
 * every timer test would have to sleep in real time — slow, and flaky under load.
 * Injecting the clock keeps those tests instant and deterministic.
 */
export interface Clock {
  now(): number;
  /** Schedule `fn` after `delayMs`. Returns a cancel function, safe to call twice. */
  setTimer(delayMs: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer: (delayMs, fn) => {
    const handle = setTimeout(fn, delayMs);
    // Timers must not hold the process open; a room's clock is not a reason to
    // keep the server alive during shutdown.
    handle.unref?.();
    return () => clearTimeout(handle);
  },
};

interface Scheduled {
  readonly at: number;
  readonly fn: () => void;
  cancelled: boolean;
}

/**
 * A clock that only moves when a test moves it.
 *
 * `advance` fires due timers in time order, and re-checks after each one, so a
 * timer that schedules another timer inside the advanced window still fires in
 * the same call — which is exactly what a turn clock rolling into its discard
 * grace does.
 */
export class FakeClock implements Clock {
  private current: number;
  private scheduled: Scheduled[] = [];

  constructor(start = 1_700_000_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimer(delayMs: number, fn: () => void): () => void {
    const entry: Scheduled = { at: this.current + delayMs, fn, cancelled: false };
    this.scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  /** Move time forward, firing everything that comes due along the way. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.scheduled
        .filter((s) => !s.cancelled && s.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.scheduled = this.scheduled.filter((s) => s !== due);
      this.current = due.at;
      due.fn();
    }
    this.current = target;
    this.scheduled = this.scheduled.filter((s) => !s.cancelled);
  }

  /** Timers still outstanding — a room that is torn down should leave none. */
  pendingCount(): number {
    return this.scheduled.filter((s) => !s.cancelled).length;
  }
}
