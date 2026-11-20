/**
 * What a player was left holding when a round ended, and what it cost them, for
 * the scoreboard's "Show cards".
 *
 * The penalty is the engine's own arithmetic: `scoreRound` subtracts the size of
 * each held card's `cardValue`, hand and foot alike, so a held red three costs
 * 500 and a held black three costs 5. Each card's cost here comes from the same
 * `cardValue`, so the lines a player reads add up to `breakdown.heldPenalty` by
 * construction; a test holds the two together in case either one changes.
 *
 * The cards are split three ways, into the hand, the foot and the red threes,
 * because those are the three different stories behind a penalty: cards still in
 * hand, a foot never reached (or not played out), and the one card that costs 500
 * however it got there. The red threes are pulled out of the zone they sat in, so
 * the three lines add up to the total rather than counting a red three twice.
 */
import { cardValue } from "@hf/engine";
import { isRedThree, type Card, type HeldCards, type RulesConfig } from "@hf/shared";

/** One held card and what it cost, as a negative number (or 0). */
export interface HeldCard {
  readonly card: Card;
  readonly cost: number;
}

export interface HeldGroup {
  readonly cards: readonly HeldCard[];
  /** The group's cost, as a negative number (or 0). */
  readonly sum: number;
}

export interface HeldBreakdown {
  /** Cards left in hand, red threes aside. */
  readonly hand: HeldGroup;
  /** Cards left in the foot, red threes aside. */
  readonly foot: HeldGroup;
  /** The player never picked their foot up. */
  readonly footUntouched: boolean;
  /** Red threes left in hand or foot. */
  readonly redThrees: HeldGroup;
  /** Every card left, the three groups together. */
  readonly count: number;
  /** What they cost: `breakdown.heldPenalty`. */
  readonly total: number;
}

/** A held card's cost: the size of its value, as a loss. */
export function heldCost(card: Card, config: RulesConfig): number {
  return -Math.abs(cardValue(card, config));
}

function group(cards: readonly Card[], config: RulesConfig): HeldGroup {
  const costed = cards.map((card) => ({ card, cost: heldCost(card, config) }));
  return { cards: costed, sum: costed.reduce((sum, c) => sum + c.cost, 0) };
}

export function heldBreakdown(held: HeldCards, config: RulesConfig): HeldBreakdown {
  const hand = group(
    held.hand.filter((c) => !isRedThree(c)),
    config,
  );
  const foot = group(
    held.foot.filter((c) => !isRedThree(c)),
    config,
  );
  const redThrees = group([...held.hand, ...held.foot].filter(isRedThree), config);
  return {
    hand,
    foot,
    footUntouched: held.footUntouched,
    redThrees,
    count: hand.cards.length + foot.cards.length + redThrees.cards.length,
    total: hand.sum + foot.sum + redThrees.sum,
  };
}

/**
 * What a player's red threes cost them this round, for the scoreboard's "Red 3s"
 * column: the size of the table's red-three value, as a loss, for each one held,
 * which is what `scoreRound` takes off for them inside the held penalty.
 */
export function redThreePenalty(redThreesHeld: number, config: RulesConfig): number {
  return redThreesHeld === 0 ? 0 : -redThreesHeld * Math.abs(config.scoring.redThree);
}
