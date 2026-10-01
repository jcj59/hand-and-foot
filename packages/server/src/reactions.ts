/**
 * How often a seat may react: a small burst, then one every couple of seconds.
 *
 * A token bucket rather than a fixed gap, because reactions come in clusters — a
 * "Nice!" and a 🎉 together is ordinary — while a stream of them is spam. It is
 * kept in memory only: reactions are never stored, so neither is their budget, and
 * a table that restarts or a Durable Object that wakes simply starts everyone with
 * a full bucket again.
 */
import type { Clock } from "./clock";

/** Reactions a seat may send at once. */
export const REACTION_BURST = 3;
/** How long it takes to earn one more. */
export const REACTION_REFILL_MS = 2_000;

export class ReactionLimiter {
  private readonly buckets = new Map<number, { tokens: number; at: number }>();

  constructor(private readonly clock: Clock) {}

  /** Spend one of the seat's reactions if it has one. */
  take(seat: number): boolean {
    const now = this.clock.now();
    const bucket = this.buckets.get(seat) ?? { tokens: REACTION_BURST, at: now };
    const tokens = Math.min(REACTION_BURST, bucket.tokens + (now - bucket.at) / REACTION_REFILL_MS);
    if (tokens < 1) {
      this.buckets.set(seat, { tokens, at: now });
      return false;
    }
    this.buckets.set(seat, { tokens: tokens - 1, at: now });
    return true;
  }
}
