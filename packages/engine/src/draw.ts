import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";

/**
 * Draw a single card from the top of the stock into the current player's active
 * zone and advance from the draw phase to the play phase. Stock exhaustion and
 * the foot-pending draw path are handled in later diffs.
 */
export function applyDraw(state: GameState): ApplyResult {
  if (state.phase !== "draw") {
    return fail("a card can only be drawn during the draw phase");
  }
  if (state.stock.length === 0) {
    return fail("the stock is empty");
  }
  const drawn = state.stock[0];
  return ok(
    updatePlayer({ ...state, stock: state.stock.slice(1), phase: "play" }, state.currentSeat, (p) =>
      setActiveCards(p, [...activeCards(p), drawn]),
    ),
  );
}
