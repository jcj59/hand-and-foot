import type { Action, GameState, RulesConfig } from "@hf/shared";
import { deal } from "./deal";
import { isMatchOver, matchTotals } from "./nextRound";
import { defaultAction, heuristicAction } from "./policy";
import { applyAction } from "./reducer";
import { project } from "./view";

/**
 * Something that chooses a seat's move. It is handed the whole state so the
 * arena can seat `defaultAction`, which is a server-side stand-in and reads it;
 * a policy that plays as a player should look only at `project(state, seat)`,
 * as `heuristicPolicy` does.
 */
export type Policy = (state: GameState, seat: number) => Action | null;

/** The server's safe default for an absent seat. Never melds; see `defaultAction`. */
export const defaultPolicy: Policy = (state) => defaultAction(state);

/** The playing heuristic, given only what the seat itself would be sent. */
export const heuristicPolicy: Policy = (state, seat) =>
  heuristicAction(project(state, seat), state.config);

/**
 * Turns allowed in one round before the arena calls it stalled. A round of
 * nothing but `defaultAction` never ends, so without a bound it would run
 * forever; real rounds between players who meld finish in a few hundred actions.
 */
export const ROUND_ACTION_LIMIT = 5_000;

export interface MatchResult {
  /** Each seat's total over the rounds that ended, in seat order. */
  readonly totals: readonly number[];
  /** Rounds that ended, by a player going out or by the stock running out. */
  readonly roundsEnded: number;
  /** The seat that went out of each ended round, or null if the stock ended it. */
  readonly wentOut: readonly (number | null)[];
  /** Whether every round of the match ended; false when one hit `ROUND_ACTION_LIMIT`. */
  readonly complete: boolean;
  /** Player actions applied, not counting the table's `nextRound`. */
  readonly actions: number;
}

/**
 * Play one match headlessly, seat `i` choosing its moves with `policies[i]`, and
 * deal each next round as the table would once a round ends.
 *
 * A policy that proposes a move the reducer refuses — or none at all on its own
 * turn — is a bug in the policy, not a position to play around, so the arena
 * throws naming the seed, the seat and the refusal, rather than quietly
 * substituting another move and reporting a result the policy did not earn.
 *
 * Pure and deterministic: the same policies, rules and seed give the same match.
 */
export function playMatch(
  policies: readonly Policy[],
  config: RulesConfig,
  seed: number,
  roundActionLimit = ROUND_ACTION_LIMIT,
): MatchResult {
  let state = deal(policies.length, config, seed);
  const wentOut: (number | null)[] = [];
  let actions = 0;
  let inRound = 0;

  for (;;) {
    if (state.roundEnded) {
      wentOut.push(state.wentOutSeat ?? null);
      if (isMatchOver(state)) break;
      state = (applyAction(state, { type: "nextRound" }) as { state: GameState }).state;
      inRound = 0;
      continue;
    }
    if (inRound >= roundActionLimit) {
      return {
        totals: matchTotals(state),
        roundsEnded: wentOut.length,
        wentOut,
        complete: false,
        actions,
      };
    }
    const seat = state.currentSeat;
    const action = policies[seat](state, seat);
    if (action === null) {
      throw new Error(`seed ${seed}: seat ${seat} proposed no move on its own turn`);
    }
    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(
        `seed ${seed}: seat ${seat} proposed ${JSON.stringify(action)}, refused: ${result.error}`,
      );
    }
    state = result.state;
    actions += 1;
    inRound += 1;
  }
  return {
    totals: matchTotals(state),
    roundsEnded: wentOut.length,
    wentOut,
    complete: true,
    actions,
  };
}

/** The seats holding the highest total — more than one on a tie. */
export function winners(result: MatchResult): number[] {
  const best = Math.max(...result.totals);
  return result.totals.flatMap((total, seat) => (total === best ? [seat] : []));
}
