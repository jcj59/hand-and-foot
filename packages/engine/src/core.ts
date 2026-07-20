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
