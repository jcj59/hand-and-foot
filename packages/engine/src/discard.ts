import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";

/**
 * Discard exactly one card from the current player's active zone to the top of
 * the discard pile, ending the turn: play advances to the next seat in the draw
 * phase. The foot-pending consequence of emptying the hand by discarding is
 * added in a later diff.
 */
export function applyDiscard(state: GameState, cardId: string): ApplyResult {
  if (state.phase !== "play") {
    return fail("a card can only be discarded during the play phase");
  }
  const seat = state.currentSeat;
  const cards = activeCards(state.players[seat]);
  const idx = cards.findIndex((c) => c.id === cardId);
  if (idx === -1) {
    return fail("that card is not in the current player's hand");
  }
  const card = cards[idx];
  const remaining = [...cards.slice(0, idx), ...cards.slice(idx + 1)];
  const afterDiscard = updatePlayer({ ...state, discard: [...state.discard, card] }, seat, (p) =>
    setActiveCards(p, remaining),
  );
  const nextSeat = (seat + 1) % state.players.length;
  return ok({ ...afterDiscard, currentSeat: nextSeat, phase: "draw" });
}
