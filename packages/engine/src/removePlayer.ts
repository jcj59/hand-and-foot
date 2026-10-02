import { MIN_PLAYERS, type GameState } from "@hf/shared";
import { type ApplyResult, fail, ok } from "./core";
import { isMatchOver } from "./nextRound";
import { isSeated, seatedCount } from "./seats";

/**
 * Take a player out of the match between rounds, so the rest carry on without them.
 *
 * Only between rounds: mid-round their cards are in play, and taking them out
 * would change a round everyone else is halfway through. Only at a family table,
 * since a competitive match's result should not depend on who stayed. And never
 * below the fewest players a game needs.
 *
 * Nothing about the finished round changes. The departing player is scored for it
 * like everyone else when the next round is dealt — their cards are still where
 * the round left them, which is what that score is worked out from — and the
 * departure only tells the next deal to leave their seat out. Their cards are
 * never shown to anyone: the next round is a fresh deal from a smaller shoe.
 */
export function applyRemovePlayer(state: GameState, seat: number): ApplyResult {
  if (!state.roundEnded) return fail("a player can only leave between rounds");
  if (isMatchOver(state)) return fail("the match is over");
  if (state.config.mode !== "family") {
    return fail("only a family game can carry on without a player");
  }
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) {
    return fail("there is no such player");
  }
  if (!isSeated(state, seat)) return fail("that player has already left");
  if (seatedCount(state) - 1 < MIN_PLAYERS) {
    return fail(`a game needs at least ${MIN_PLAYERS} players`);
  }
  return ok({
    ...state,
    departed: [...(state.departed ?? []), { seat, afterRound: state.roundNumber }],
  });
}
