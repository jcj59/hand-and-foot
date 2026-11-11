/**
 * How melds are read at the table, as words and in an order: what each one still
 * needs, its short form for a chip, the two ways of sorting them, and how far a
 * player in their foot is from the books that let them go out.
 *
 * Pure, so the table, the other players' boxes and their sheet all say the same
 * thing about the same meld. Whether a meld is a book, and of which kind, is the
 * engine's `classifyBook`, so nothing here can disagree with scoring.
 */
import { isWild, type Meld, type Rank, type RulesConfig } from "@hf/shared";
import { classifyBook } from "@hf/engine";

/** The two orders the design offers: by rank, or the latest meld laid first. */
export type MeldOrder = "rank" | "newest";

/** Black threes first (they meld only from the foot), then the naturals ascending. */
const RANK_ORDER: readonly Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

/** A meld's size at which it becomes a book. */
export const BOOK_SIZE = 7;

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

/** What is said under a meld: how many more make it a book, or which book it is. */
export function meldNote(meld: Meld): { readonly text: string; readonly tone: MeldTone } {
  const kind = classifyBook(meld);
  if (kind === "clean") return { text: "Clean book", tone: "clean" };
  if (kind === "dirty") return { text: "Dirty book", tone: "dirty" };
  return { text: `${BOOK_SIZE - meld.cards.length} more for a book`, tone: "open" };
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

export interface GoOutGoal {
  readonly label: "Clean books" | "Dirty books";
  readonly have: number;
  readonly need: number;
  readonly done: boolean;
}

export interface GoOutProgress {
  readonly goals: readonly GoOutGoal[];
  /** The unfinished meld nearest to a book, while a book is still wanted. */
  readonly nearest: string | null;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six"] as const;

/**
 * The books a player has against the books going out needs, as the engine's
 * `canGoOut` counts them: clean and dirty separately, each at least the table's
 * number. A rule asking for none of a kind has no goal shown for it.
 */
export function goOutProgress(melds: readonly Meld[], config: RulesConfig): GoOutProgress {
  const books = booksOf(melds);
  const clean = books.filter((kind) => kind === "clean").length;
  const dirty = books.length - clean;
  const goals: GoOutGoal[] = [];
  if (config.goOutCleanBooks > 0) {
    goals.push({
      label: "Clean books",
      have: clean,
      need: config.goOutCleanBooks,
      done: clean >= config.goOutCleanBooks,
    });
  }
  if (config.goOutDirtyBooks > 0) {
    goals.push({
      label: "Dirty books",
      have: dirty,
      need: config.goOutDirtyBooks,
      done: dirty >= config.goOutDirtyBooks,
    });
  }
  const wanting = goals.some((goal) => !goal.done);
  const open = melds.filter((meld) => classifyBook(meld) === "incomplete");
  const closest = open.reduce<Meld | null>(
    (best, meld) => (best === null || meld.cards.length > best.cards.length ? meld : best),
    null,
  );
  let nearest: string | null = null;
  if (wanting && closest) {
    const short = BOOK_SIZE - closest.cards.length;
    nearest = `Your ${closest.rank}s need ${NUMBER_WORDS[short]} more card${short === 1 ? "" : "s"}`;
  }
  return { goals, nearest };
}
