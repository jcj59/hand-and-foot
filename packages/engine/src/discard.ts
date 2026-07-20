import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";
import { canGoOut } from "./goout";

/**
 * Discard exactly one card from the current player's active zone. If a picked-up
 * pile card still owes a play, the turn cannot end yet. Discarding the last card
 * of the foot is going out with a discard, which ends the round immediately and
 * requires the go-out books. Discarding the last card of the hand makes the foot
 * pending. Otherwise the turn advances to the next seat in the draw phase, and a
 * running final lap (from a without-discard go-out) is decremented.
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
  const afterDiscard = updatePlayer({ ...state, discard: [...state.discard, card] }, seat, (p) =>
    setActiveCards(p, remaining),
  );

  // Going out with a discard: the foot is now empty.
  if (player.inFoot && remaining.length === 0) {
    if (!canGoOut(player, state.config)) {
      return fail("you cannot go out yet: you still need the required books");
    }
    return ok({ ...afterDiscard, roundEnded: true });
  }

  // Emptying the hand by discarding makes the foot pending for next turn.
  const footPending = !player.inFoot && remaining.length === 0 && player.foot.length > 0;
  const withFlags = updatePlayer(afterDiscard, seat, (p) => ({
    ...p,
    footPending: footPending || p.footPending,
  }));

  // Advance the turn, decrementing a running final lap.
  let finalLap = state.finalLapRemaining;
  let roundEnded = false;
  if (finalLap !== undefined && finalLap > 0) {
    finalLap -= 1;
    if (finalLap === 0) roundEnded = true;
  }
  const nextSeat = (seat + 1) % state.players.length;
  return ok({
    ...withFlags,
    currentSeat: nextSeat,
    phase: "draw",
    finalLapRemaining: finalLap,
    roundEnded,
  });
}
