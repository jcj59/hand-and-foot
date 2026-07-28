import type { GameState } from "@hf/shared";
import { type ApplyResult, activeCards, fail, ok, setActiveCards, updatePlayer } from "./core";
import { prng, shuffle } from "./rng";

/**
 * The draw phase. If the player has a pending foot, the foot is picked up in
 * place of a draw. Otherwise a single card is drawn from the top of the stock. If
 * the stock is empty, the configured stock-exhaustion behavior applies: by
 * default the discard pile (below its top card) is reshuffled into a new stock
 * and the draw proceeds; alternatively the round ends. The reshuffle uses a seed
 * derived from the game seed, so it is deterministic and replayable.
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

  let source = state;
  if (source.stock.length === 0) {
    if (source.config.stockExhaustion === "end" || source.discard.length <= 1) {
      return ok({ ...source, roundEnded: true });
    }
    const top = source.discard[source.discard.length - 1];
    const rest = source.discard.slice(0, -1);
    const restocked = shuffle(rest, prng(source.seed + source.roundNumber + 1));
    source = { ...source, stock: restocked, discard: [top] };
  }

  const drawn = source.stock[0];
  return ok(
    updatePlayer({ ...source, stock: source.stock.slice(1), phase: "play" }, seat, (p) =>
      setActiveCards(p, [...activeCards(p), drawn]),
    ),
  );
}
