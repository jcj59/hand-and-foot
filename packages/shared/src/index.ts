// Shared domain types and constants for Hand and Foot.
// Imported by the engine, the server, and the client so the contract stays in one place.

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export type Rank =
  "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A" | "JOKER";

export interface Card {
  /** Unique id per physical card across all decks in play. */
  readonly id: string;
  readonly rank: Rank;
  /** null for jokers. */
  readonly suit: Suit | null;
}

/** In this family variant, 2s and jokers are wild. */
export const WILD_RANKS: ReadonlySet<Rank> = new Set<Rank>(["2", "JOKER"]);

export function isWild(rank: Rank): boolean {
  return WILD_RANKS.has(rank);
}

export type GameMode = "family" | "competitive";

/** How wild cards may be mixed into a meld (the East Coast vs. West Coast difference). */
export type WildRatioRule = "naturals-exceed-wilds" | "naturals-equal-wilds";

export interface StageTimers {
  readonly drawMs: number;
  readonly meldMs: number;
  readonly discardMs: number;
  /** Time added to the meld clock on each submission (Fischer-style increment). */
  readonly meldIncrementMs: number;
}

export interface RulesConfig {
  /** Number of rounds in the match (1 to 4). */
  readonly rounds: number;
  /** Per-round point minimum required to lay your first melds. */
  readonly layDownMinimums: readonly number[];
  readonly wildRatio: WildRatioRule;
  readonly marvaRule: boolean;
  readonly goOutCleanBooks: number;
  readonly goOutDirtyBooks: number;
  readonly handSize: number;
  readonly footSize: number;
  readonly mode: GameMode;
  readonly pauseEnabled: boolean;
  readonly timers: StageTimers;
}

/** East Coast preset (default): naturals must strictly outnumber wilds; Family-paced. */
export const EAST_COAST: RulesConfig = {
  rounds: 1,
  layDownMinimums: [60],
  wildRatio: "naturals-exceed-wilds",
  marvaRule: false,
  goOutCleanBooks: 1,
  goOutDirtyBooks: 2,
  handSize: 14,
  footSize: 14,
  mode: "family",
  pauseEnabled: true,
  timers: { drawMs: 30000, meldMs: 45000, discardMs: 20000, meldIncrementMs: 10000 },
};

/** West Coast preset: wilds may equal naturals. Otherwise identical for now. */
export const WEST_COAST: RulesConfig = {
  ...EAST_COAST,
  wildRatio: "naturals-equal-wilds",
};
