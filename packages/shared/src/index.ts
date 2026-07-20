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

/** A card is red if it is a diamond or a heart. */
export function isRed(card: Card): boolean {
  return card.suit === "diamonds" || card.suit === "hearts";
}

/** Red threes are a penalty card and can never be melded. */
export function isRedThree(card: Card): boolean {
  return card.rank === "3" && isRed(card);
}

/** Black threes are meldable only from the foot, as a book of seven or more. */
export function isBlackThree(card: Card): boolean {
  return card.rank === "3" && (card.suit === "clubs" || card.suit === "spades");
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

/** Point values and bonuses used when scoring a round. */
export interface ScoringConfig {
  readonly joker: number;
  readonly two: number;
  readonly ace: number;
  readonly tenToKing: number;
  readonly fourToNine: number;
  readonly blackThree: number;
  /** Signed value of a red three (a penalty; never melded). */
  readonly redThree: number;
  readonly cleanBookBonus: number;
  readonly dirtyBookBonus: number;
  readonly goOutBonus: number;
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
  /** Extra decks beyond one per player; decks in play = playerCount + extraDecks. */
  readonly extraDecks: number;
  /** Flip one card from the stock to start the discard pile after dealing (assumption; confirm). */
  readonly initialDiscardFlip: boolean;
  readonly scoring: ScoringConfig;
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
  extraDecks: 1,
  initialDiscardFlip: true,
  scoring: {
    joker: 50,
    two: 20,
    ace: 15,
    tenToKing: 10,
    fourToNine: 5,
    blackThree: 5,
    redThree: -500,
    cleanBookBonus: 500,
    dirtyBookBonus: 300,
    goOutBonus: 100,
  },
  mode: "family",
  pauseEnabled: true,
  timers: { drawMs: 30000, meldMs: 45000, discardMs: 20000, meldIncrementMs: 10000 },
};

/** West Coast preset: wilds may equal naturals. Otherwise identical for now. */
export const WEST_COAST: RulesConfig = {
  ...EAST_COAST,
  wildRatio: "naturals-equal-wilds",
};

export type Zone = "hand" | "foot";

export type Phase = "draw" | "play" | "discard";

export interface Meld {
  readonly rank: Rank;
  readonly cards: readonly Card[];
}

export interface PlayerState {
  readonly hand: readonly Card[];
  readonly foot: readonly Card[];
  readonly melds: readonly Meld[];
  readonly isDown: boolean;
  readonly inFoot: boolean;
  readonly footPending: boolean;
  /** Ids of pile cards taken this turn that still owe a play (take-pile obligation). */
  readonly pickedUp?: readonly string[];
}

export interface GameState {
  readonly config: RulesConfig;
  readonly seed: number;
  readonly roundNumber: number;
  readonly players: readonly PlayerState[];
  readonly currentSeat: number;
  readonly phase: Phase;
  readonly stock: readonly Card[];
  readonly discard: readonly Card[];
  /** True once the round has ended (a player has gone out). */
  readonly roundEnded?: boolean;
  /** Remaining turns in the final lap after a without-discard go-out. */
  readonly finalLapRemaining?: number;
}

/** What one player can see of another player: counts, not hidden card contents. */
export interface OpponentView {
  readonly seat: number;
  readonly handCount: number;
  readonly footCount: number;
  readonly melds: readonly Meld[];
  readonly isDown: boolean;
  readonly inFoot: boolean;
}

/** The filtered game state a single player is allowed to see (the anti-cheat boundary). */
export interface PlayerView {
  readonly seat: number;
  readonly hand: readonly Card[];
  /** Own foot cards, revealed only once picked up (inFoot); otherwise null. */
  readonly foot: readonly Card[] | null;
  readonly footCount: number;
  readonly melds: readonly Meld[];
  readonly isDown: boolean;
  readonly inFoot: boolean;
  readonly opponents: readonly OpponentView[];
  readonly discard: readonly Card[];
  readonly stockCount: number;
  readonly currentSeat: number;
  readonly phase: Phase;
  readonly roundNumber: number;
}

/** One meld a player lays or extends: the cards to add and the rank they form. */
export interface MeldPlay {
  readonly rank: Rank;
  readonly cardIds: readonly string[];
}

/** A player action submitted to the engine. */
export type Action =
  | { readonly type: "draw" }
  | { readonly type: "takePile" }
  | { readonly type: "playMelds"; readonly melds: readonly MeldPlay[] }
  | { readonly type: "discard"; readonly cardId: string };
