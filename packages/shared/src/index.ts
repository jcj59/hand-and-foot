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

/**
 * Pacing for a single turn. The **turn**, not the phase, is the unit of time:
 * the discard stopped being a phase of its own, so there is no longer anything
 * for a per-stage clock to attach to.
 *
 * A turn starts with `baseMs` and earns `incrementMs` for each accepted action,
 * so a player who is actively laying down is not punished for taking the moves
 * to do it. The accrued total can never push the turn past `capMs` from the
 * moment it started: that hard ceiling is the whole point, since an unbounded
 * turn is the thing the clock exists to prevent, and it also makes farming the
 * increment harmless rather than something to police.
 *
 * When the clock expires with no discard played yet, `discardGraceMs` opens a
 * discard-only window *on top of* the cap. Melding is closed, but the player
 * still picks their own card instead of having one picked for them — which is
 * the point of the grace, so the cap must not eat it.
 */
export interface TurnTimers {
  /** Clock a turn starts with. */
  readonly baseMs: number;
  /** Added to the turn clock on each accepted action. */
  readonly incrementMs: number;
  /** Hard ceiling on one turn's wall clock, increments included. */
  readonly capMs: number;
  /** Discard-only window granted, on top of the cap, once the clock expires. */
  readonly discardGraceMs: number;
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
  /**
   * Number of rounds in the match. **Reserved and currently unenforced**: the first
   * release is a single round, so nothing advances `roundNumber` past 1 and no code
   * reads this field. It is kept so the config shape stays stable for multi-round
   * matches (roadmap item 1); wire it up there rather than assuming it works.
   */
  readonly rounds: number;
  /**
   * Per-round point minimum required to lay your first melds, indexed by
   * `roundNumber - 1`. This one *is* honored, so escalating minimums already work
   * as soon as rounds advance.
   */
  readonly layDownMinimums: readonly number[];
  readonly wildRatio: WildRatioRule;
  readonly marvaRule: boolean;
  readonly goOutCleanBooks: number;
  readonly goOutDirtyBooks: number;
  readonly handSize: number;
  readonly footSize: number;
  /** Extra decks beyond one per player; decks in play = playerCount + extraDecks. */
  readonly extraDecks: number;
  /**
   * Flip one card from the stock to start the discard pile after dealing. Confirmed
   * as the house rule (2026-08-04). Turning it off is supported and tested; it makes
   * the first player's take-pile impossible rather than merely unlikely.
   */
  readonly initialDiscardFlip: boolean;
  /** What happens when the stock runs out mid-round. */
  readonly stockExhaustion: "reshuffle" | "end";
  readonly scoring: ScoringConfig;
  readonly mode: GameMode;
  /**
   * Whether any player may pause the table. Unrestricted by design in Family
   * mode (2026-08-09): the player on the clock can pause their own turn, which
   * makes `timers.capMs` a hard ceiling in Competitive play and a soft one at a
   * family table. That is the intended trade, not an oversight — add a pause
   * budget only if it is actually abused.
   */
  readonly pauseEnabled: boolean;
  readonly timers: TurnTimers;
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
  stockExhaustion: "reshuffle",
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
  timers: { baseMs: 90_000, incrementMs: 10_000, capMs: 180_000, discardGraceMs: 20_000 },
};

/** West Coast preset: wilds may equal naturals. Otherwise identical for now. */
export const WEST_COAST: RulesConfig = {
  ...EAST_COAST,
  wildRatio: "naturals-equal-wilds",
};

export type Zone = "hand" | "foot";

/**
 * A turn is `draw -> play`; the discard is what ends the play phase rather than a
 * phase of its own, and a player who has shed every card ends the turn without one.
 * The client derives "you must discard now" from the play phase plus a settled
 * take-pile obligation.
 */
export type Phase = "draw" | "play";

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
  /** True once the round has ended (a player went out, or the stock ran out). */
  readonly roundEnded?: boolean;
  /** Remaining turns in the final lap after a without-discard go-out. */
  readonly finalLapRemaining?: number;
  /**
   * Seat of the player who went out, if any. A player may shed every card without
   * holding the go-out books, so having no cards left is not by itself going out;
   * only this seat earns the go-out bonus.
   */
  readonly wentOutSeat?: number;
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

/** One player's score for a completed round. */
export interface RoundScore {
  readonly seat: number;
  readonly score: number;
}

export * from "./protocol";
