import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";

/**
 * The draw phase. If the player has a pending foot (they emptied their hand by
 * discarding last turn), the foot is picked up in place of a draw: no stock card
 * is taken and the pile cannot be taken. Otherwise a single card is drawn from
 * the top of the stock into the active zone. Either way the phase advances to
 * play. Stock exhaustion is handled in a later diff.
 */
export function applyDraw(state: GameState): ApplyResult {
  if (state.phase !== "draw") {
    return fail("a card can only be drawn during the draw phase");
  }
  const seat = state.currentSeat;
  const player = state.players[seat];

  if (player.footPending) {
    return ok(
      updatePlayer({ ...state, phase: "play" }, seat, (p) => ({
        ...p,
        inFoot: true,
        footPending: false,
      })),
    );
  }

  if (state.stock.length === 0) {
    return fail("the stock is empty");
  }
  const drawn = state.stock[0];
  return ok(
    updatePlayer({ ...state, stock: state.stock.slice(1), phase: "play" }, seat, (p) =>
      setActiveCards(p, [...activeCards(p), drawn]),
    ),
  );
}
