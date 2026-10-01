/**
 * Cards written the way a person would jot them down: `KH` is the king of hearts,
 * `10S` the ten of spades, `3D` a red three, `JK` a joker. A scenario names the
 * cards that make its situation and nothing else, so this is the whole notation.
 */
import type { Card, Rank, Suit } from "@hf/shared";

/** One card as written: a rank, and a suit for everything but a joker. */
export interface CardRef {
  readonly rank: Rank;
  readonly suit: Suit | null;
  /** As written, for saying which card could not be found. */
  readonly text: string;
}

const SUITS: Readonly<Record<string, Suit>> = {
  C: "clubs",
  D: "diamonds",
  H: "hearts",
  S: "spades",
};
const RANKS: ReadonlySet<string> = new Set([
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
]);

/** Parse one card. Throws on anything else: a typo in a scenario is a bug in it. */
export function parseCard(text: string): CardRef {
  const t = text.trim().toUpperCase();
  if (t === "JK") return { rank: "JOKER", suit: null, text: t };
  const rank = t.slice(0, -1);
  const suit = SUITS[t.slice(-1)];
  if (!RANKS.has(rank) || !suit) throw new Error(`"${text}" is not a card (try KH, 10S, JK)`);
  return { rank: rank as Rank, suit, text: t };
}

/** Parse a list of cards separated by spaces: `"KH KS 2C"`. */
export function parseCards(text: string): CardRef[] {
  return text.split(/\s+/).filter(Boolean).map(parseCard);
}

export function matches(card: Card, ref: CardRef): boolean {
  return card.rank === ref.rank && card.suit === ref.suit;
}

/**
 * Take the cards a list names out of `pool`, first match each, and return them
 * with what is left. Throws naming the first card it could not find, and where.
 */
export function takeCards(
  pool: readonly Card[],
  refs: readonly CardRef[],
  where: string,
): { taken: Card[]; rest: Card[] } {
  const rest = [...pool];
  const taken: Card[] = [];
  for (const ref of refs) {
    const index = rest.findIndex((card) => matches(card, ref));
    if (index === -1) throw new Error(`no ${ref.text} ${where}`);
    taken.push(rest[index]!);
    rest.splice(index, 1);
  }
  return { taken, rest };
}
