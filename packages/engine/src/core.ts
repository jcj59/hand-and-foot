import type { Card, GameState, PlayerState } from "@hf/shared";

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

/** Return a copy of the state with one seat's player replaced by fn(player). */
export function updatePlayer(
  state: GameState,
  seat: number,
  fn: (p: PlayerState) => PlayerState,
): GameState {
  return { ...state, players: state.players.map((p, i) => (i === seat ? fn(p) : p)) };
}

/**
 * End the current player's turn: pass to the next seat in the draw phase and
 * decrement a running final lap (started by a without-discard go-out), ending the
 * round once it reaches zero. A turn normally ends with a discard, but a player
 * who has shed every card ends it without one, so both paths share this.
 */
export function advanceTurn(state: GameState, seat: number): GameState {
  let finalLap = state.finalLapRemaining;
  let roundEnded = false;
  if (finalLap !== undefined && finalLap > 0) {
    finalLap -= 1;
    if (finalLap === 0) roundEnded = true;
  }
  return {
    ...state,
    currentSeat: (seat + 1) % state.players.length,
    phase: "draw",
    finalLapRemaining: finalLap,
    roundEnded,
  };
}
