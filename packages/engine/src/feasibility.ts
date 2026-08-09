import { type GameState, type MeldPlay } from "@hf/shared";
import { activeCards } from "./core";
import { greedyLayDown } from "./plan";

export interface Feasibility {
  readonly feasible: boolean;
  /** A witness lay-down that satisfies the requirements, when feasible. */
  readonly plan?: readonly MeldPlay[];
}

/**
 * Whether the current player may take the entire discard pile: there must be a
 * lay-down that plays at least one pile card, and, if the player is not yet
 * down, reaches the round minimum using pile cards together with the hand.
 *
 * This is a sound solver: whenever it reports feasible it returns a plan that is
 * a valid, minimum-meeting lay-down, so a player can never take the pile and get
 * stuck. The search itself lives in `greedyLayDown`, shared with the default
 * policy that has to discharge the obligation afterwards.
 */
export function canTakePile(state: GameState, seat: number): Feasibility {
  const pile = state.discard;
  if (pile.length === 0) {
    return { feasible: false };
  }
  const player = state.players[seat];
  const plan = greedyLayDown(
    [...activeCards(player), ...pile],
    player.melds,
    new Set(pile.map((c) => c.id)),
    state.config,
  );

  if (!plan.usesRequired) {
    return { feasible: false };
  }
  if (!player.isDown) {
    const minimum = state.config.layDownMinimums[state.roundNumber - 1] ?? 0;
    if (plan.value < minimum) {
      return { feasible: false };
    }
  }
  return { feasible: true, plan: plan.plays };
}
