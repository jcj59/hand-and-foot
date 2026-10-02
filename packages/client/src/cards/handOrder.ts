/**
 * The order cards sit in on screen.
 *
 * Purely presentational — the engine does not care how a hand is arranged — but not
 * arbitrary. Fourteen cards plus a foot is a lot to scan, and the arrangement is
 * what makes a meld visible at a glance, so it groups cards by how they play rather
 * than by rank alone:
 *
 *   1. Naturals, ascending. The meldable bulk, with same-ranks adjacent so three of
 *      a kind is seen rather than hunted for.
 *   2. Black threes. Meldable only from the foot, and only as a book of seven, so
 *      they are not part of the ordinary scan.
 *   3. Wilds — twos, then jokers. Kept together at the end because they are a
 *      resource to spend across any meld rather than a rank to collect.
 *   4. Red threes. A penalty that can never be melded; last because there is
 *      nothing to do with them.
 *
 * Sorting by rank alone would scatter these: the rank order runs from "2" to
 * "JOKER", which puts one kind of wild first and the other last, and drops both
 * kinds of three in among the naturals.
 */
import { isBlackThree, isRed, isRedThree, isWild, type Card, type Rank } from "@hf/shared";

/** Ascending, for the natural group. Threes and wilds are ordered by group instead. */
const NATURAL_ORDER: readonly Rank[] = [
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
] as const;

/** Stable tie-break so two renders of the same hand never differ. */
const SUIT_ORDER = ["clubs", "diamonds", "hearts", "spades"] as const;

/** Which of the four bands a card belongs to. Lower sorts earlier. */
export function displayGroup(card: Card): number {
  if (isRedThree(card)) return 3;
  if (isWild(card.rank)) return 2;
  if (isBlackThree(card)) return 1;
  return 0;
}

function withinGroup(card: Card): number {
  // Jokers after twos inside the wild band: a joker is the more valuable wild, and
  // a consistent position stops it from moving as the hand changes.
  if (isWild(card.rank)) return card.rank === "2" ? 0 : 1;
  const index = NATURAL_ORDER.indexOf(card.rank);
  // A three is the only rank outside NATURAL_ORDER that reaches here, and both
  // kinds already have a band to themselves, so their position within it is only
  // the suit tie-break below.
  return index === -1 ? 0 : index;
}

export function compareForDisplay(a: Card, b: Card): number {
  const byGroup = displayGroup(a) - displayGroup(b);
  if (byGroup !== 0) return byGroup;
  const byRank = withinGroup(a) - withinGroup(b);
  if (byRank !== 0) return byRank;
  return SUIT_ORDER.indexOf(a.suit ?? "clubs") - SUIT_ORDER.indexOf(b.suit ?? "clubs");
}

/** A copy in display order. Never sorts in place: the view's cards are readonly. */
export function sortForDisplay(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareForDisplay);
}

/** True when a card is one the player cannot do anything with. Dimmed on screen. */
export function isDeadWeight(card: Card): boolean {
  return isRedThree(card);
}

/** What decides whether a black three in the player's own cards can be played. */
export interface PlayContext {
  readonly inFoot: boolean;
  /** Black threes in the cards being played from — the hand, or the foot. */
  readonly blackThreesHeld: number;
  /** Wilds in the same cards, which can make a black-three book up to seven. */
  readonly wildsHeld: number;
  /** Whether a meld of black threes is already down. */
  readonly hasBlackThreeMeld: boolean;
}

/**
 * Whether one of the player's own cards is out of play right now, and so drawn
 * dimmed and offered no meld.
 *
 * A red three never plays. A black three plays only from the foot, and only as a
 * book of seven or more — so it is live there only when the player already has
 * that book down to add to, or holds enough to make one: seven threes, or at least
 * four (the most wilds either wild ratio lets into seven cards is three) and wilds
 * to make up the rest. Everywhere else it is as dead as a red three, and saying so
 * on the card saves the player trying.
 */
export function isUnplayable(card: Card, context: PlayContext): boolean {
  if (isRedThree(card)) return true;
  if (!isBlackThree(card)) return false;
  const { blackThreesHeld: threes, wildsHeld: wilds } = context;
  const canMakeBook = threes >= BLACK_THREE_BOOK - 3 && threes + wilds >= BLACK_THREE_BOOK;
  return !(context.inFoot && (canMakeBook || context.hasBlackThreeMeld));
}

/** Cards in a book of black threes, the fewest that may be melded. */
const BLACK_THREE_BOOK = 7;

/**
 * Whether a card from the hand can go straight onto one of the player's melds:
 * a natural of a rank they have down, that is in play at all. The rank alone is
 * not enough — a red three shares its rank with a book of black threes and still
 * can never be melded — so this is the one test the underline, the discard
 * warning and the card's menu all use. Wilds are left out: where one goes is a
 * choice, not a lay-off.
 */
export function canLayOff(card: Card, meldRanks: ReadonlySet<Rank>, context: PlayContext): boolean {
  return !isWild(card.rank) && !isUnplayable(card, context) && meldRanks.has(card.rank);
}

/** Red for hearts and diamonds, as on a real card. */
export function isRedCard(card: Card): boolean {
  return isRed(card);
}
