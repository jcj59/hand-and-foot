import {
  type GameState,
  type LegalHints,
  type Rank,
  isBlackThree,
  isRedThree,
  isWild,
} from "@hf/shared";
import { activeCards } from "./core";
import { canTakePile } from "./feasibility";
import { canGoOut } from "./goout";

// `LegalHints` itself lives in `@hf/shared`: it crosses the socket inside a
// `ViewUpdate`, so the client has to be able to name the type too. Re-exported
// here so that existing `@hf/engine` importers are unaffected.
export type { LegalHints };

function meldableRanks(state: GameState, seat: number): Rank[] {
  const player = state.players[seat];
  const zone = activeCards(player);
  const counts = new Map<Rank, number>();
  for (const c of zone) {
    if (isWild(c.rank) || isRedThree(c) || isBlackThree(c)) continue;
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  const existing = new Set(player.melds.map((m) => m.rank));
  const out: Rank[] = [];
  for (const [rank, count] of counts) {
    if (existing.has(rank) ? count >= 1 : count >= 3) out.push(rank);
  }
  if (player.inFoot && zone.filter(isBlackThree).length >= 7) out.push("3");
  return out;
}

/**
 * A read-only summary of the moves available to the current player. It does not
 * enumerate concrete meld combinations; it reports which kinds of action are
 * available now, using the same predicates the reducer uses so it cannot disagree
 * with what the reducer will accept. For a player who is not yet down, the
 * reported meldable ranks are structurally formable, but a first lay-down still
 * has to reach the round minimum, which is checked when the action is applied.
 */
export function legalHints(state: GameState, seat: number): LegalHints {
  const isTurn = seat === state.currentSeat && !state.roundEnded;
  const player = state.players[seat];
  if (!isTurn) {
    return {
      seatToAct: state.currentSeat,
      phase: state.phase,
      canDraw: false,
      canTakePile: false,
      meldableRanks: [],
      canGoOut: false,
    };
  }
  if (state.phase === "draw") {
    return {
      seatToAct: seat,
      phase: "draw",
      canDraw: true,
      canTakePile: !player.footPending && canTakePile(state, seat).feasible,
      meldableRanks: [],
      canGoOut: false,
    };
  }
  return {
    seatToAct: seat,
    phase: state.phase,
    canDraw: false,
    canTakePile: false,
    meldableRanks: meldableRanks(state, seat),
    canGoOut: canGoOut(player, state.config),
  };
}
