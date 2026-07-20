import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";
import { canTakePile } from "./feasibility";

/**
 * Take the entire discard pile. Allowed only when the feasibility check passes,
 * which guarantees a completable lay-down using at least one pile card exists.
 * The whole pile moves into the active zone, an obligation to play at least one
 * of the picked-up cards is recorded, and the phase advances to play. The player
 * keeps the rest of the pile and still discards to end the turn; a following
 * playMelds must satisfy the obligation before a discard is allowed.
 */
export function applyTakePile(state: GameState): ApplyResult {
  if (state.phase !== "draw") {
    return fail("the pile can only be taken during the draw phase");
  }
  const seat = state.currentSeat;
  const player = state.players[seat];
  if (player.footPending) {
    return fail("you must pick up your foot this turn, not the pile");
  }
  if (state.discard.length === 0) {
    return fail("the discard pile is empty");
  }
  if (!canTakePile(state, seat).feasible) {
    return fail(
      "you cannot take the pile: no pile card is playable, or the minimum is not reachable",
    );
  }

  const pile = state.discard;
  const pickedUp = pile.map((c) => c.id);
  return ok(
    updatePlayer({ ...state, discard: [], phase: "play" }, seat, (p) => ({
      ...setActiveCards(p, [...activeCards(p), ...pile]),
      pickedUp,
    })),
  );
}
