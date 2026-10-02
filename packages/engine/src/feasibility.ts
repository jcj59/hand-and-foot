import { type GameState, type MeldPlay } from "@hf/shared";
import { activeCards } from "./core";
import { greedyLayDown } from "./plan";

export interface Feasibility {
  readonly feasible: boolean;
  /** A witness lay-down that satisfies the requirements, when feasible. */
  readonly plan?: readonly MeldPlay[];
  /**
   * Why not, when not: the pile is empty, no pile card can be played, or the best
   * lay-down with it falls short of the minimum — with what it reaches.
   */
  readonly why?:
    | { readonly kind: "empty" }
    | { readonly kind: "unplayable" }
    | { readonly kind: "short"; readonly value: number; readonly minimum: number };
}

/**
 * The points a lay-down by this seat must reach this round: the round's minimum
 * until the player is down, and nothing after. A round the config sets no minimum
 * for has none.
 */
export function layDownMinimum(state: GameState, seat: number): number {
  if (state.players[seat].isDown) return 0;
  return state.config.layDownMinimums[state.roundNumber - 1] ?? 0;
}

/**
 * Why this seat cannot take the pile now, in words for the player, or null when it
 * can, or when the question does not arise — not their turn, or past the draw.
 * Told only to the seat it is about: it is worked out from their own cards and the
 * face-up pile, which is all they could work it out from at a real table.
 */
export function takePileWhy(state: GameState, seat: number): string | null {
  if (state.roundEnded || seat !== state.currentSeat || state.phase !== "draw") return null;
  const why = canTakePile(state, seat).why;
  if (!why) return null;
  switch (why.kind) {
    case "empty":
      return "the discard pile is empty";
    case "unplayable":
      return "none of the pile's cards can be played with yours: a card needs a pair of its rank (or one and a wild), or a meld of its rank already down";
    case "short":
      return `with the pile your best lay-down is worth ${why.value}, short of the ${why.minimum} you need to get down`;
  }
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
    return { feasible: false, why: { kind: "empty" } };
  }
  const player = state.players[seat];
  const minimum = layDownMinimum(state, seat);
  const plan = greedyLayDown(
    [...activeCards(player), ...pile],
    player.melds,
    new Set(pile.map((c) => c.id)),
    state.config,
    { minimum, inFoot: player.inFoot },
  );

  if (!plan.usesRequired) {
    return { feasible: false, why: { kind: "unplayable" } };
  }
  if (plan.value < minimum) {
    return { feasible: false, why: { kind: "short", value: plan.value, minimum } };
  }
  return { feasible: true, plan: plan.plays };
}
