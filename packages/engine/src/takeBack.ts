import type { GameState, PlayerState } from "@hf/shared";
import { type ApplyResult, fail, ok, updatePlayer, withoutTurnBase } from "./core";

/**
 * Take back every meld played this turn.
 *
 * Nothing a player lays down is final until the turn ends, the way it is at a real
 * table: a player who put a wild on the wrong meld, or split a group they meant to
 * keep, picks the cards back up before discarding. So the seat as it was before
 * the turn's first play is kept (`GameState.turnBase`), and this puts it back —
 * cards to the zone they came from, melds as they were, the go-down undone if this
 * turn made it, and the take-pile obligation owed again if the plays settled it.
 *
 * What it never undoes is anything the player has seen or the table has been
 * shown to happen: the draw or the pile pickup, and a foot picked up mid-turn by
 * melding the hand away. Picking up the foot clears the base, so the plays before
 * it are final and only those after it can be taken back — undoing past it would
 * let the player replan with cards they could not have known about.
 */
export function applyTakeBack(state: GameState): ApplyResult {
  if (state.phase !== "play") {
    return fail("there is nothing to take back before drawing");
  }
  const base = state.turnBase;
  if (!base || base.seat !== state.currentSeat) {
    return fail("nothing has been played this turn to take back");
  }
  return ok(withoutTurnBase(updatePlayer(state, base.seat, () => base.player)));
}

/**
 * The state with the seat's pre-play self recorded as the turn base, unless one
 * is already recorded — the base is the seat before the turn's *first* play.
 */
export function withTurnBase(state: GameState, seat: number, before: PlayerState): GameState {
  if (state.turnBase?.seat === seat) return state;
  return { ...state, turnBase: { seat, player: before } };
}
