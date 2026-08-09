import type { GameState } from "@hf/shared";
import {
  type ApplyResult,
  activeCards,
  advanceTurn,
  fail,
  ok,
  setActiveCards,
  updatePlayer,
} from "./core";
import { claimsGoOut } from "./goout";

/**
 * Discard exactly one card from the current player's active zone. If a picked-up
 * pile card still owes a play, the turn cannot end yet.
 *
 * Discarding the last card of the foot ends the round only if the player is the one
 * going out. Without the books the discard is still legal: the player simply keeps
 * playing with no cards, drawing one each turn until the books are complete, so
 * shedding every card early is a bad position rather than an illegal move. (An
 * earlier version rejected the discard, which deadlocked the turn: a player who
 * had melded down to one card had no legal action left at all.)
 *
 * Discarding the last card of the hand makes the foot pending. Otherwise the turn
 * advances to the next seat in the draw phase.
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

  // Going out with a discard: the foot is now empty, the books are complete, and
  // nobody has gone out yet. Otherwise the player has just shed every card and the
  // turn ends normally.
  if (player.inFoot && remaining.length === 0 && claimsGoOut(state, player)) {
    return ok({ ...afterDiscard, roundEnded: true, wentOutSeat: seat });
  }

  // Emptying the hand by discarding makes the foot pending for next turn.
  const footPending = !player.inFoot && remaining.length === 0 && player.foot.length > 0;
  const withFlags = updatePlayer(afterDiscard, seat, (p) => ({
    ...p,
    footPending: footPending || p.footPending,
  }));

  return ok(advanceTurn(withFlags, seat));
}
