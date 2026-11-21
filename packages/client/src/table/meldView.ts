/**
 * How melds are read at the table, as words and in an order: what each one is
 * worth, its folded form for a chip, its accessible name, and the two ways of
 * sorting them.
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

/** How a wild is labeled on a folded meld: by its own rank, a two or a joker. */
export type WildLabel = "2" | "JK";

/**
 * A meld folded to a chip: its rank, every card it holds, its kind, and each wild
 * by its own rank (`K 6 [2][JK]`). The count is the meld's whole size, the
 * number a player reads under a meld laid out as cards, so the two views agree;
 * the wilds are shown for what they are, twos before jokers, the order a fan
 * draws them in.
 */
export interface MeldChip {
  readonly rank: Rank;
  readonly count: number;
  readonly tone: MeldTone;
  readonly wilds: readonly WildLabel[];
}

export function meldChip(meld: Meld): MeldChip {
  const wilds = meld.cards
    .filter((card) => isWild(card.rank))
    .map((card): WildLabel => (card.rank === "JOKER" ? "JK" : "2"))
    .sort((a, b) => (a === b ? 0 : a === "2" ? -1 : 1));
  const kind = classifyBook(meld);
  return {
    rank: meld.rank,
    count: meld.cards.length,
    tone: kind === "incomplete" ? "open" : kind,
    wilds,
  };
}

/**
 * The meld's accessible name. States the rank, the size and the wilds together,
 * because that is the whole meaning of a meld and hearing seven card names is not
 * a substitute for it: "Meld of Ks, 6 cards, 2 wild", "clean book of 9s, 7 cards".
 */
export function meldLabel(meld: Meld): string {
  const kind = classifyBook(meld);
  const size = `${meld.cards.length} card${meld.cards.length === 1 ? "" : "s"}`;
  const wilds = meld.cards.filter((card) => isWild(card.rank)).length;
  const wild = wilds === 0 ? "" : `, ${wilds} wild`;
  return kind === "incomplete"
    ? `Meld of ${meld.rank}s, ${size}${wild}`
    : `${kind} book of ${meld.rank}s, ${size}${wild}`;
}

/** Each finished book, in the order the melds are given: the markers on a player's chip. */
export function booksOf(melds: readonly Meld[]): ("clean" | "dirty")[] {
  return melds.map(classifyBook).filter((kind) => kind !== "incomplete");
}
