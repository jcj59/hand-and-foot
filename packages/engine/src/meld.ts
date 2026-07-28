import { type Card, type RulesConfig, type Rank, isWild } from "@hf/shared";

/** The result of validating a meld: valid, or invalid with a human-readable reason. */
export type MeldValidation = { valid: true } | { valid: false; reason: string };

/** The number of wild cards (2s and jokers) among the given cards. */
export function countWilds(cards: readonly Card[]): number {
  return cards.reduce((n, c) => (isWild(c.rank) ? n + 1 : n), 0);
}

/** The rank of the natural (non-wild) cards in a meld, or null if there are none. */
export function naturalRank(cards: readonly Card[]): Rank | null {
  const natural = cards.find((c) => !isWild(c.rank));
  return natural ? natural.rank : null;
}

/**
 * Structural validity of a meld, independent of game state: a single natural
 * rank, at least three cards, not composed entirely of wilds, and a wild ratio
 * permitted by the config (East Coast requires naturals to strictly outnumber
 * wilds; West Coast allows them to be equal). State-dependent placement rules
 * for red and black threes are enforced separately at action time.
 */
export function validateMeld(cards: readonly Card[], config: RulesConfig): MeldValidation {
  if (cards.length < 3) {
    return { valid: false, reason: "a meld needs at least 3 cards" };
  }
  const wilds = countWilds(cards);
  const naturals = cards.length - wilds;
  if (naturals === 0) {
    return { valid: false, reason: "a meld cannot be made of only wild cards" };
  }
  const rank = naturalRank(cards);
  const mixedRanks = cards.some((c) => !isWild(c.rank) && c.rank !== rank);
  if (mixedRanks) {
    return { valid: false, reason: "all natural cards in a meld must share one rank" };
  }
  if (config.wildRatio === "naturals-exceed-wilds" && naturals <= wilds) {
    return { valid: false, reason: "naturals must outnumber wilds (East Coast)" };
  }
  if (config.wildRatio === "naturals-equal-wilds" && wilds > naturals) {
    return { valid: false, reason: "wilds cannot outnumber naturals (West Coast)" };
  }
  return { valid: true };
}

/** Convenience boolean form of validateMeld. */
export function isValidMeld(cards: readonly Card[], config: RulesConfig): boolean {
  return validateMeld(cards, config).valid;
}
