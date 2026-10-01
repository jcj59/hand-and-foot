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
 *
 * It lives in the engine rather than the server because it is a pure function of
 * the log, and the server is not its only reader: the replay and scenario player
 * work it out from the same actions, so a match watched back names the same holder
 * at the same moment as the table did.
 */
import type { Action, GrabbyPants } from "@hf/shared";

/** Pickups in a row that earn the title. */
export const GRABBY_STREAK = 3;

/** An action with the seat it was applied to — all the title needs from a log entry. */
export interface SeatedAction {
  readonly seat: number;
  readonly action: Action;
}

interface Tally {
  readonly holder: GrabbyPants | null;
  readonly streakSeat: number | null;
  readonly streak: number;
}

const START: Tally = { holder: null, streakSeat: null, streak: 0 };

function step(tally: Tally, entry: SeatedAction): Tally {
  if (entry.action.type !== "takePile") return tally;
  const streak = entry.seat === tally.streakSeat ? tally.streak + 1 : 1;
  const next = { ...tally, streakSeat: entry.seat, streak };
  if (streak < GRABBY_STREAK) return next;
  const holder = tally.holder;
  if (holder?.seat === entry.seat) {
    // The holder extending their own streak raises the bar for everyone else.
    return streak > holder.streak ? { ...next, holder: { ...holder, streak } } : next;
  }
  if (!holder || streak > holder.streak) {
    return {
      ...next,
      holder: { seat: entry.seat, streak, ...(holder ? { from: holder.seat } : {}) },
    };
  }
  return next;
}

/** Who holds the title after the whole log. */
export function grabbyPants(log: readonly SeatedAction[]): GrabbyPants | null {
  return log.reduce(step, START).holder;
}

/**
 * Who held the title after each prefix of the log: entry `k` is the holder once
 * the first `k` actions had been played, so the result is one longer than the log.
 * One pass, for a player that needs the answer at every step of a match.
 */
export function grabbyHistory(log: readonly SeatedAction[]): (GrabbyPants | null)[] {
  const out: (GrabbyPants | null)[] = [null];
  let tally = START;
  for (const entry of log) {
    tally = step(tally, entry);
    out.push(tally.holder);
  }
  return out;
}
