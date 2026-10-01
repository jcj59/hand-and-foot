import type { Action, GameState, LastMove, RoundEnded } from "@hf/shared";
import { activeCards } from "./core";
import { isMatchOver, matchTotals } from "./nextRound";
import { scoreRound } from "./scoreRound";

/**
 * What a table would say about an action it just applied, as the full truth: a
 * draw names the card drawn. `seq` is the caller's, since only the caller knows
 * how moves are numbered — the server by its log, a replay by its own steps.
 * Dealing the next round is the table's doing rather than a move, so it has none.
 *
 * Worked out here rather than by the server alone so that a recorded match played
 * back says exactly what the live table said at the same point.
 */
export function describeMove(
  seq: number,
  seat: number,
  action: Action,
  before: GameState,
  after: GameState,
): LastMove | null {
  switch (action.type) {
    case "draw": {
      const had = new Set(activeCards(before.players[seat]!).map((c) => c.id));
      const drawn = activeCards(after.players[seat]!).find((c) => !had.has(c.id));
      // A draw that met an exhausted stock ended the round instead of drawing.
      return { seq, seat, kind: "draw", ...(drawn ? { card: drawn } : {}) };
    }
    case "takePile":
      return { seq, seat, kind: "takePile", count: before.discard.length };
    case "playMelds":
      return {
        seq,
        seat,
        kind: "meld",
        count: action.melds.reduce((n, m) => n + m.cardIds.length, 0),
      };
    case "takeBack":
      return { seq, seat, kind: "takeBack" };
    case "discard":
      return { seq, seat, kind: "discard", card: after.discard.at(-1)! };
    case "nextRound":
      return null;
  }
}

/**
 * The move as one seat may see it. A drawn card is its drawer's alone; everyone
 * else is told only that a card was drawn — the field is absent, not empty, so
 * nothing about the card is left behind.
 */
export function moveSeenBy(move: LastMove, seat: number): LastMove {
  if (move.kind !== "draw" || move.seat === seat || move.card === undefined) return move;
  return { seq: move.seq, seat: move.seat, kind: "draw" };
}

/** How a finished round came out, as every seat is told it. Null while it is being played. */
export function roundResult(state: GameState): RoundEnded | null {
  if (!state.roundEnded) return null;
  return {
    scores: scoreRound(state),
    ...(state.wentOutSeat !== undefined ? { wentOutSeat: state.wentOutSeat } : {}),
    roundNumber: state.roundNumber,
    totals: matchTotals(state),
    matchOver: isMatchOver(state),
  };
}
