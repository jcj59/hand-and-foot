import type { Departure, GameState } from "@hf/shared";

/**
 * Who is still playing. A player who leaves between rounds keeps their seat
 * number — rounds are scored by seat, and what they scored still counts on the
 * scoreboard — so the seats of a match are not simply `0..players.length - 1` any
 * more once someone has gone. Everything that walks round the table asks here.
 */

/** Whether a seat is still in the match. */
export function isSeated(state: GameState, seat: number): boolean {
  return !(state.departed ?? []).some((d) => d.seat === seat);
}

/** How many players are still in the match. */
export function seatedCount(state: GameState): number {
  return state.players.length - (state.departed ?? []).length;
}

/** The next seat to the left of `seat` that is still in the match. */
export function nextSeated(state: GameState, seat: number): number {
  let next = (seat + 1) % state.players.length;
  while (!isSeated(state, next)) next = (next + 1) % state.players.length;
  return next;
}

/** Whether a seat has left the match before `roundNumber` was dealt. */
export function sitsOut(
  departed: readonly Departure[],
  seat: number,
  roundNumber: number,
): boolean {
  return departed.some((d) => d.seat === seat && d.afterRound < roundNumber);
}
