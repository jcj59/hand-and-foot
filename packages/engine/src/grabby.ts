/**
 * Grabby Pants: the table's title for whoever last took the discard pile three
 * times running.
 *
 * A streak is a player's pile pickups with nobody else picking up the pile in
 * between — other players drawing and discarding does not break it, only someone
 * else grabbing the pile does. Three in a row earns the title, from nobody or
 * from whoever held it: there is no bar to clear beyond the three. It lasts the
 * round. Each new round starts with nobody holding it and no streak carried
 * over, so it is a title for how a round is being played, not a record for the
 * match.
 *
 * It is worked out from the action log, the round boundary included — the
 * `nextRound` action is the reset — so nothing is stored, a restart or a Durable
 * Object waking gets the same answer, and every seat sees the same holder.
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
  // A new round: nobody holds the title, and no streak runs on into it.
  if (entry.action.type === "nextRound") return START;
  if (entry.action.type !== "takePile") return tally;
  const streak = entry.seat === tally.streakSeat ? tally.streak + 1 : 1;
  const next = { ...tally, streakSeat: entry.seat, streak };
  if (streak < GRABBY_STREAK) return next;
  const holder = tally.holder;
  // The holder going on keeps it, with the streak counted up.
  if (holder?.seat === entry.seat) return { ...next, holder: { ...holder, streak } };
  return {
    ...next,
    holder: { seat: entry.seat, streak, ...(holder ? { from: holder.seat } : {}) },
  };
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
