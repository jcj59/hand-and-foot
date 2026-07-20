import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";

/**
 * Discard exactly one card from the current player's active zone to the top of
 * the discard pile, ending the turn: play advances to the next seat in the draw
 * phase. If a card taken from the pile this turn still owes a play, the turn
 * cannot be ended yet. If the discard empties the hand (and the player has not
 * yet reached the foot), the foot becomes pending for the player's next turn.
 */
export function applyDiscard(state: GameState, cardId: string): ApplyResult {
  if (state.phase !== "play") {
    return fail("a card can only be discarded during the play phase");
  }
  const seat = state.currentSeat;
  const player = state.players[seat];
  if ((player.pickedUp ?? []).length > 0) {
    return fail("you must play at least one card taken from the pile before discarding");
  }
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
