import {
  type Card,
  type GameState,
  type MeldPlay,
  type Rank,
  isBlackThree,
  isRedThree,
  isWild,
} from "@hf/shared";
import { activeCards } from "./core";
import { validateMeld } from "./meld";
import { cardValue } from "./scoring";

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
 * stuck. It forms natural-rank melds (three or more of a rank) and extends the
 * player's existing melds; it does not yet optimize wild-card allocation across
 * ranks, which can make it conservative in rare wild-heavy positions. The bot
 * milestone refines the search; the guarantee that a reported plan is completable
 * holds regardless.
 */
export function canTakePile(state: GameState, seat: number): Feasibility {
  const pile = state.discard;
  if (pile.length === 0) {
    return { feasible: false };
  }
  const player = state.players[seat];
  const pileIds = new Set(pile.map((c) => c.id));
  const available = [...activeCards(player), ...pile];

  const naturalsByRank = new Map<Rank, Card[]>();
  for (const c of available) {
    if (isWild(c.rank) || isRedThree(c) || isBlackThree(c)) continue;
    const arr = naturalsByRank.get(c.rank);
    if (arr) arr.push(c);
    else naturalsByRank.set(c.rank, [c]);
  }
  const existing = new Map(player.melds.map((m) => [m.rank, m.cards.length] as const));

  const plays: MeldPlay[] = [];
  let value = 0;
  let usesPile = false;
  for (const [rank, naturals] of naturalsByRank) {
    const hasExisting = existing.has(rank);
    const canForm = hasExisting ? naturals.length >= 1 : naturals.length >= 3;
    if (!canForm) continue;
    // Defensive, and currently unreachable: `naturals` is three or more cards of a
    // single rank with no wilds, which every wild-ratio setting accepts. It becomes
    // live the moment the search starts allocating wilds into plans, so it stays.
    /* v8 ignore next */
    if (!hasExisting && !validateMeld(naturals, state.config).valid) continue;

    plays.push({ rank, cardIds: naturals.map((c) => c.id) });
    value += naturals.reduce((sum, c) => sum + cardValue(c, state.config), 0);
    const total = (existing.get(rank) ?? 0) + naturals.length;
    if (total >= 7 && (existing.get(rank) ?? 0) < 7) {
      value += state.config.scoring.cleanBookBonus;
    }
    if (naturals.some((c) => pileIds.has(c.id))) {
      usesPile = true;
    }
  }

  if (!usesPile) {
    return { feasible: false };
  }
  if (!player.isDown) {
    const minimum = state.config.layDownMinimums[state.roundNumber - 1] ?? 0;
    if (value < minimum) {
      return { feasible: false };
    }
  }
  return { feasible: true, plan: plays };
}
