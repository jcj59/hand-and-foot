/**
 * Grabby Pants: the table's title for whoever takes the discard pile the most
 * times running.
 *
 * A streak is a player's pile pickups with nobody else picking up the pile in
 * between — other players drawing and discarding does not break it, only someone
 * else grabbing the pile does. Three in a row earns the title; to take it from its
 * holder, another player needs a longer streak than the holder's best. It lasts
 * the match, so it is worked out from the whole action log: nothing is stored,
 * a restart or a Durable Object waking gets the same answer, and every seat sees
 * the same holder.
 */
import type { GrabbyPants, LoggedAction } from "@hf/shared";

/** Pickups in a row that earn the title. */
export const GRABBY_STREAK = 3;

export function grabbyPants(log: readonly LoggedAction[]): GrabbyPants | null {
  let holder = null as GrabbyPants | null;
  let streakSeat: number | null = null;
  let streak = 0;
  for (const entry of log) {
    if (entry.action.type !== "takePile") continue;
    streak = entry.seat === streakSeat ? streak + 1 : 1;
    streakSeat = entry.seat;
    if (streak < GRABBY_STREAK) continue;
    if (holder?.seat === entry.seat) {
      // The holder extending their own streak raises the bar for everyone else.
      if (streak > holder.streak) holder = { ...holder, streak };
    } else if (!holder || streak > holder.streak) {
      holder = { seat: entry.seat, streak, ...(holder ? { from: holder.seat } : {}) };
    }
  }
  return holder;
}
