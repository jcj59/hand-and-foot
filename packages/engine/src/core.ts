import type { Card, GameState, PlayerState } from "@hf/shared";
import { nextSeated } from "./seats";

/** The outcome of applying an action: the next state, or a rejection reason. */
export type ApplyResult =
  { readonly ok: true; readonly state: GameState } | { readonly ok: false; readonly error: string };

export function ok(state: GameState): ApplyResult {
  return { ok: true, state };
}

export function fail(error: string): ApplyResult {
  return { ok: false, error };
}

/** The zone a player is currently playing from: the hand, or the foot once picked up. */
export function activeCards(p: PlayerState): readonly Card[] {
  return p.inFoot ? p.foot : p.hand;
}

/** Return a copy of the player with the active zone replaced. */
export function setActiveCards(p: PlayerState, cards: readonly Card[]): PlayerState {
  return p.inFoot ? { ...p, foot: cards } : { ...p, hand: cards };
}

/** The state with no turn base: the turn's plays are final; see `applyTakeBack`. */
export function withoutTurnBase(state: GameState): GameState {
  if (state.turnBase === undefined) return state;
  const rest = { ...state };
  delete rest.turnBase;
  return rest;
}

/** Return a copy of the state with one seat's player replaced by fn(player). */
export function updatePlayer(
  state: GameState,
  seat: number,
  fn: (p: PlayerState) => PlayerState,
): GameState {
  return { ...state, players: state.players.map((p, i) => (i === seat ? fn(p) : p)) };
}

/**
 * End the current player's turn: pass to the next player still in the match and
 * decrement a running final lap (started by a without-discard go-out), ending the
 * round once it reaches zero. A turn normally ends with a discard, but a player
 * who has shed every card ends it without one, so both paths share this.
 *
 * The next turn normally opens in the draw phase. A player whose foot is pending —
 * they emptied their hand with a discard — picks the foot up *in place of* drawing,
 * and taking the pile is not open to them either, so there is no choice to make:
 * their turn opens already holding the foot, in the play phase. Doing it here rather
 * than as an action the player must submit is what makes the pickup automatic.
 */
export function advanceTurn(state: GameState, seat: number): GameState {
  let finalLap = state.finalLapRemaining;
  let roundEnded = false;
  if (finalLap !== undefined && finalLap > 0) {
    finalLap -= 1;
    if (finalLap === 0) roundEnded = true;
  }
  const next = nextSeated(state, seat);
  // The turn is over, so whatever it played is final.
  const passed: GameState = {
    ...withoutTurnBase(state),
    finalLapRemaining: finalLap,
    roundEnded,
  };
  return roundEnded ? { ...passed, currentSeat: next, phase: "draw" } : openTurn(passed, next);
}

/**
 * Hand the turn to `seat`, opening it in the draw phase — or, for a player whose
 * foot is pending, already holding the foot in the play phase (see `advanceTurn`).
 * Every way a turn can end must pass through here, including going out without a
 * discard: the seat after the player going out may have emptied their own hand last
 * turn, and skipping the pickup leaves them drawing into an empty hand.
 */
export function openTurn(state: GameState, seat: number): GameState {
  const opened: GameState = { ...state, currentSeat: seat, phase: "draw" };
  if (!state.players[seat].footPending) return opened;
  return updatePlayer({ ...opened, phase: "play" }, seat, (p) => ({
    ...p,
    inFoot: true,
    footPending: false,
  }));
}
