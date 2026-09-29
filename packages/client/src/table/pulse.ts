/**
 * One rhythm for everything on the table that is asking to be clicked.
 *
 * A CSS animation starts when its element appears, so two piles that became
 * clickable a moment apart would glow out of step. Each one instead starts part
 * way through its cycle, at the point the wall clock says every such animation is
 * at, which keeps them in phase however and whenever they appear.
 */

/** Length of one glow cycle. Must match `--pulse-period` in index.css. */
export const PULSE_PERIOD_MS = 1400;

/** The style that puts an element's pulse in phase with every other one. */
export function pulseStyle(now: number = Date.now()): { animationDelay: string } {
  return { animationDelay: `-${now % PULSE_PERIOD_MS}ms` };
}
