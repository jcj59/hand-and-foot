import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";

/**
 * Discard exactly one card from the current player's active zone to the top of
 * the discard pile, ending the turn: play advances to the next seat in the draw
 * phase. If the discard empties the hand (and the player has not yet reached the
 * foot), the foot becomes pending, so on this player's next turn it is picked up
 * in place of a draw.
 */
export function applyDiscard(state: GameState, cardId: string): ApplyResult {
  if (state.phase !== "play") {
    return fail("a card can only be discarded during the play phase");
  }
  const seat = state.currentSeat;
  const player = state.players[seat];
  const cards = activeCards(player);
  const idx = cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    return fail("that card is not in the current player's hand");
  }
  const card = cards[idx];
  const remaining = [...cards.slice(0, idx), ...cards.slice(idx + 1)];
  const footPending = !player.inFoot && remaining.length === 0 && player.foot.length > 0;
  const afterDiscard = updatePlayer({ ...state, discard: [...state.discard, card] }, seat, (p) => ({
    ...setActiveCards(p, remaining),
    footPending: footPending || p.footPending,
  }));
  const nextSeat = (seat + 1) % state.players.length;
  return ok({ ...afterDiscard, currentSeat: nextSeat, phase: "draw" });
}
