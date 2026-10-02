import type { GameState } from "@hf/shared";
import { type ApplyResult, fail, ok } from "./core";
import { deal } from "./deal";
import { scoreRound } from "./scoreRound";

/**
 * Deal the next round of a match: a fresh shoe from that round's seed, the first
 * turn one seat further on than last round's (rotating from the match's own first
 * seat), and the finished round's scores kept in `pastRounds`,
 * which is what running totals are added up from. Refused while a round is still
 * being played, and after the last one, when the match is over.
 */
export function applyNextRound(state: GameState): ApplyResult {
  if (!state.roundEnded) return fail("the round is still being played");
  if (isMatchOver(state)) return fail("that was the last round");
  const next = deal(
    state.players.length,
    state.config,
    state.seed,
    state.roundNumber + 1,
    state.firstSeat,
  );
  return ok({ ...next, pastRounds: [...(state.pastRounds ?? []), scoreRound(state)] });
}

/** Whether the last round of the match has been played. */
export function isMatchOver(state: GameState): boolean {
  return state.roundEnded === true && state.roundNumber >= state.config.rounds;
}

/**
 * Each seat's total over the match so far: every finished round, and the current
 * one too once it has ended.
 */
export function matchTotals(state: GameState): number[] {
  const rounds = [...(state.pastRounds ?? []), ...(state.roundEnded ? [scoreRound(state)] : [])];
  return state.players.map((_, seat) =>
    // A round's scores are in seat order, one per player, so each seat's is at its index.
    rounds.reduce((total, round) => total + round[seat]!.score, 0),
  );
}
