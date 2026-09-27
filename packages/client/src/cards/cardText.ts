/**
 * Putting a card into words and symbols.
 *
 * Kept apart from the component that draws it so the labels can be asserted
 * directly, and because they are used in two places: the face of the card, and its
 * accessible name. The accessible name is not decoration here — it is how the
 * tests find a specific card among fourteen, and how the table is usable at all
 * without sight of the suit glyphs.
 */
import { isRed, isWild, type Card, type Rank, type Suit } from "@hf/shared";

/** The glyph on the face. Jokers have no suit, so they get a star. */
export function suitSymbol(suit: Suit | null): string {
  switch (suit) {
    case "clubs":
      return "♣";
    case "diamonds":
      return "♦";
    case "hearts":
      return "♥";
    case "spades":
      return "♠";
    default:
      return "★";
  }
}

/** Short form for the corner of the card. */
export function rankLabel(rank: Rank): string {
  return rank === "JOKER" ? "JKR" : rank;
}

const RANK_WORDS: Readonly<Record<Rank, string>> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  "10": "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
  JOKER: "Joker",
};

/**
 * The card in words, with the part that changes how it plays said out loud.
 *
 * Wildness and the two kinds of three are called out because they are the rules a
 * player has to hold in mind while looking at their hand — a red three is a penalty
 * that can never be melded, a black three only ever melds from the foot — and
 * because a glyph alone does not convey any of it.
 */
export function cardLabel(card: Card): string {
  if (card.rank === "JOKER") return "Joker, wild";
  const base = `${RANK_WORDS[card.rank]} of ${card.suit ?? "no suit"}`;
  if (isWild(card.rank)) return `${base}, wild`;
  if (card.rank === "3") return isRed(card) ? `${base}, penalty` : `${base}, blocks the pile`;
  return base;
}
