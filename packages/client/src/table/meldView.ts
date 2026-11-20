/**
 * How melds are read at the table, as words and in an order: what each one is
 * worth, its short form for a chip, and the two ways of sorting them.
 *
 * Pure, so the table, the other players' boxes and their sheet all say the same
 * thing about the same meld. Whether a meld is a book, and of which kind, is the
 * engine's `classifyBook`, so nothing here can disagree with scoring.
 */
import { isWild, type Meld, type Rank, type RulesConfig } from "@hf/shared";
import { classifyBook, meldPoints } from "@hf/engine";

/** The two orders the design offers: by rank, or the latest meld laid first. */
export type MeldOrder = "rank" | "newest";

/** Black threes first (they meld only from the foot), then the naturals ascending. */
const RANK_ORDER: readonly Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

/**
 * Melds in the chosen order. A player's melds are kept in the order they were
 * first laid (the engine adds a new rank at the end and grows an old one in
 * place), so "newest" is that order turned round.
 */
export function sortMelds(melds: readonly Meld[], order: MeldOrder): Meld[] {
  if (order === "newest") return [...melds].reverse();
  return [...melds].sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
}

export type MeldTone = "clean" | "dirty" | "open";

/**
 * What is said under a meld: its size, which book it is once it is one, and the
 * points its cards are worth, as the table wrote it before the redesign
 * ("5 cards · 70", "7 cards · clean · 120"). The points are the engine's
 * `meldPoints`, the cards' values alone: a book's bonus is scored by the round.
 */
export function meldNote(
  meld: Meld,
  config: RulesConfig,
): { readonly text: string; readonly tone: MeldTone } {
  const kind = classifyBook(meld);
  const size = `${meld.cards.length} card${meld.cards.length === 1 ? "" : "s"}`;
  const book = kind === "incomplete" ? "" : ` · ${kind}`;
  return {
    text: `${size}${book} · ${meldPoints(meld, config)}`,
    tone: kind === "incomplete" ? "open" : kind,
  };
}

/** A meld folded to a chip: "K ×4 +★", the naturals counted and the wilds starred. */
export function meldChip(meld: Meld): string {
  const wilds = meld.cards.filter((card) => isWild(card.rank)).length;
  const naturals = meld.cards.length - wilds;
  const star = wilds === 0 ? "" : wilds === 1 ? " +★" : ` +★${wilds}`;
  return `${meld.rank} ×${naturals}${star}`;
}

/** Each finished book, in the order the melds are given: the markers on a player's chip. */
export function booksOf(melds: readonly Meld[]): ("clean" | "dirty")[] {
  return melds.map(classifyBook).filter((kind) => kind !== "incomplete");
}
