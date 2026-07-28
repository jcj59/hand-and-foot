import { type Card, type Meld, type RulesConfig, isBlackThree, isRedThree } from "@hf/shared";
import { countWilds } from "./meld";

const TEN_TO_KING: ReadonlySet<string> = new Set(["10", "J", "Q", "K"]);
const FOUR_TO_NINE: ReadonlySet<string> = new Set(["4", "5", "6", "7", "8", "9"]);

/**
 * The point value of a single card, per the configured scoring table. Melded
 * cards contribute this value; cards held at the end of a round subtract its
 * magnitude, so a held red three costs 500 and a held black three costs 5.
 */
export function cardValue(card: Card, config: RulesConfig): number {
  const s = config.scoring;
  if (card.rank === "JOKER") return s.joker;
  if (card.rank === "2") return s.two;
  if (card.rank === "A") return s.ace;
  if (isRedThree(card)) return s.redThree;
  if (isBlackThree(card)) return s.blackThree;
  if (TEN_TO_KING.has(card.rank)) return s.tenToKing;
  if (FOUR_TO_NINE.has(card.rank)) return s.fourToNine;
  return 0;
}

export type BookKind = "clean" | "dirty" | "incomplete";

/**
 * Classify a meld as a completed book or not. A book is seven or more cards; it
 * is clean if it contains no wilds and dirty otherwise. A black-three book counts
 * as dirty even though it contains no wilds.
 */
export function classifyBook(meld: Meld): BookKind {
  if (meld.cards.length < 7) return "incomplete";
  if (meld.cards.every((c) => isBlackThree(c))) return "dirty";
  return countWilds(meld.cards) === 0 ? "clean" : "dirty";
}

/** The summed card value of a meld. */
export function meldPoints(meld: Meld, config: RulesConfig): number {
  return meld.cards.reduce((sum, c) => sum + cardValue(c, config), 0);
}
