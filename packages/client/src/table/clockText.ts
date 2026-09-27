/**
 * Turning milliseconds left into something to read on a turn timer.
 *
 * Seconds are rounded **up**, so a turn with any time at all on it never reads
 * `0:00`. Rounding down would show zero for a whole second while moves were still
 * being accepted, which reads as a bug at exactly the moment a player is hurrying.
 */

/** Below this, the timer is worth drawing attention to. */
export const URGENT_MS = 10_000;

/** Shown when there is no deadline: the table is paused, or nothing is dealt. */
export const NO_DEADLINE = "—";

export function formatRemaining(ms: number | null): string {
  if (ms === null) return NO_DEADLINE;
  const seconds = Math.ceil(Math.max(0, ms) / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Whether to draw attention to the clock. Null is not urgent — a paused table is
 * the opposite of urgent, and flashing at a player who cannot act would be noise.
 */
export function isUrgent(ms: number | null): boolean {
  return ms !== null && ms <= URGENT_MS;
}
