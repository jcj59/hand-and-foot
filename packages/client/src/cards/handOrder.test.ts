import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "@hf/shared";
import { standardDeck } from "@hf/engine";
import {
  arrange,
  canLayOff,
  moveBy,
  moveTo,
  compareForDisplay,
  displayGroup,
  isDeadWeight,
  isRedCard,
  sortForDisplay,
  isUnplayable,
  type PlayContext,
} from "./handOrder";

const card = (rank: Rank, suit: Suit | null): Card => ({ id: `${rank}-${suit}`, rank, suit });
const labels = (cards: readonly Card[]): string[] =>
  cards.map((c) => `${c.rank}${c.suit ? c.suit[0] : ""}`);

describe("the four bands", () => {
  it("puts naturals first, then black threes, then wilds, then red threes", () => {
    expect(displayGroup(card("K", "spades"))).toBe(0);
    expect(displayGroup(card("3", "clubs"))).toBe(1);
    expect(displayGroup(card("2", "hearts"))).toBe(2);
    expect(displayGroup(card("JOKER", null))).toBe(2);
    expect(displayGroup(card("3", "hearts"))).toBe(3);
  });

  it("keeps the bands in that order when sorting", () => {
    const hand = [
      card("3", "hearts"),
      card("JOKER", null),
      card("3", "spades"),
      card("5", "clubs"),
      card("2", "diamonds"),
    ];
    expect(labels(sortForDisplay(hand))).toEqual(["5c", "3s", "2d", "JOKER", "3h"]);
  });
});

describe("within the natural band", () => {
  it("sorts ascending so three of a kind sits together", () => {
    // The whole point of the arrangement: a book should be seen, not hunted for.
    const hand = [card("K", "clubs"), card("4", "spades"), card("K", "hearts"), card("9", "clubs")];
    expect(labels(sortForDisplay(hand))).toEqual(["4s", "9c", "Kc", "Kh"]);
  });

  it("orders ten below the face cards, not as a one", () => {
    // A string sort would put "10" before "4".
    const hand = [card("J", "clubs"), card("10", "clubs"), card("4", "clubs")];
    expect(labels(sortForDisplay(hand))).toEqual(["4c", "10c", "Jc"]);
  });

  it("breaks ties by suit, so the same hand never renders two ways", () => {
    const one = sortForDisplay([card("7", "spades"), card("7", "clubs"), card("7", "hearts")]);
    const other = sortForDisplay([card("7", "hearts"), card("7", "spades"), card("7", "clubs")]);
    expect(labels(one)).toEqual(["7c", "7h", "7s"]);
    expect(labels(one)).toEqual(labels(other));
  });
});

describe("within the wild band", () => {
  it("puts twos before jokers", () => {
    // A consistent position stops the joker from moving about as the hand changes.
    const hand = [card("JOKER", null), card("2", "spades"), card("2", "clubs")];
    expect(labels(sortForDisplay(hand))).toEqual(["2c", "2s", "JOKER"]);
  });
});

describe("sortForDisplay", () => {
  it("does not sort in place, because the view's cards are readonly", () => {
    const hand = [card("K", "spades"), card("4", "clubs")];
    const before = labels(hand);
    sortForDisplay(hand);
    expect(labels(hand)).toEqual(before);
  });

  it("keeps every card", () => {
    const deck = standardDeck(0);
    const sorted = sortForDisplay(deck);
    expect(sorted).toHaveLength(deck.length);
    expect(new Set(sorted.map((c) => c.id)).size).toBe(deck.length);
  });

  it("orders a whole real deck into non-decreasing bands", () => {
    // Guards the ordering against a rank with no place in it: any card the
    // comparator does not know about would break monotonicity here.
    const groups = sortForDisplay(standardDeck(0)).map(displayGroup);
    for (let i = 1; i < groups.length; i++) expect(groups[i]).toBeGreaterThanOrEqual(groups[i - 1]);
  });

  it("is a consistent comparator over a real deck", () => {
    // Sorting an already-sorted deck must not move anything.
    const once = sortForDisplay(standardDeck(0));
    expect(labels(sortForDisplay(once))).toEqual(labels(once));
  });

  it("handles an empty hand", () => {
    // A player who has shed every card still renders; the foot may be empty too.
    expect(sortForDisplay([])).toEqual([]);
  });
});

describe("compareForDisplay", () => {
  it("reports equality for two cards of the same rank and suit", () => {
    expect(compareForDisplay(card("9", "hearts"), card("9", "hearts"))).toBe(0);
  });
});

describe("dead weight and colour", () => {
  it("marks red threes as nothing-to-do-with", () => {
    // They can never be melded, so they are dimmed rather than offered.
    expect(isDeadWeight(card("3", "hearts"))).toBe(true);
    expect(isDeadWeight(card("3", "spades"))).toBe(false);
    expect(isDeadWeight(card("A", "hearts"))).toBe(false);
  });

  it("reds the hearts and diamonds", () => {
    expect(isRedCard(card("A", "hearts"))).toBe(true);
    expect(isRedCard(card("A", "diamonds"))).toBe(true);
    expect(isRedCard(card("A", "spades"))).toBe(false);
    expect(isRedCard(card("JOKER", null))).toBe(false);
  });
});

describe("isUnplayable", () => {
  const black = { id: "b3", rank: "3" as const, suit: "clubs" as const };
  const red = { id: "r3", rank: "3" as const, suit: "hearts" as const };
  const king = { id: "k", rank: "K" as const, suit: "clubs" as const };
  const inHand = { inFoot: false, blackThreesHeld: 7, wildsHeld: 3, hasBlackThreeMeld: true };
  const inFoot = { inFoot: true, blackThreesHeld: 1, wildsHeld: 0, hasBlackThreeMeld: false };

  it("never plays a red three, anywhere", () => {
    expect(isUnplayable(red, inHand)).toBe(true);
    expect(isUnplayable(red, { ...inFoot, blackThreesHeld: 7, hasBlackThreeMeld: true })).toBe(
      true,
    );
  });

  it("never plays a black three from the hand, however many are held", () => {
    expect(isUnplayable(black, inHand)).toBe(true);
  });

  it("plays a black three from the foot once seven are held", () => {
    expect(isUnplayable(black, inFoot)).toBe(true);
    expect(isUnplayable(black, { ...inFoot, blackThreesHeld: 6 })).toBe(true);
    expect(isUnplayable(black, { ...inFoot, blackThreesHeld: 7 })).toBe(false);
  });

  it("plays a black three from the foot when wilds make the seven, at four threes or more", () => {
    expect(isUnplayable(black, { ...inFoot, blackThreesHeld: 6, wildsHeld: 1 })).toBe(false);
    expect(isUnplayable(black, { ...inFoot, blackThreesHeld: 5, wildsHeld: 1 })).toBe(true);
    expect(isUnplayable(black, { ...inFoot, blackThreesHeld: 4, wildsHeld: 3 })).toBe(false);
    // Three threes and four wilds is seven cards, but the wilds outnumber them.
    expect(isUnplayable(black, { ...inFoot, blackThreesHeld: 3, wildsHeld: 4 })).toBe(true);
  });

  it("plays a black three from the foot onto a black-three book already down", () => {
    expect(isUnplayable(black, { ...inFoot, hasBlackThreeMeld: true })).toBe(false);
  });

  it("leaves every other card alone", () => {
    expect(isUnplayable(king, inHand)).toBe(false);
    expect(isUnplayable(king, inFoot)).toBe(false);
  });
});

describe("what can go straight onto a meld", () => {
  const ctx = (over: Partial<PlayContext> = {}): PlayContext => ({
    inFoot: true,
    blackThreesHeld: 0,
    wildsHeld: 0,
    hasBlackThreeMeld: true,
    ...over,
  });
  const c = (rank: Card["rank"], suit: Card["suit"]): Card => ({
    id: `${rank}${suit}`,
    rank,
    suit,
  });

  it("is a natural of a rank already down", () => {
    expect(canLayOff(c("9", "hearts"), new Set(["9"]), ctx())).toBe(true);
    expect(canLayOff(c("9", "hearts"), new Set(["K"]), ctx())).toBe(false);
  });

  it("is never a wild, whose place is a choice", () => {
    expect(canLayOff(c("2", "clubs"), new Set(["2" as Card["rank"]]), ctx())).toBe(false);
  });

  it("is never a red three, even beside a book of black threes", () => {
    expect(canLayOff(c("3", "hearts"), new Set(["3"]), ctx())).toBe(false);
    expect(canLayOff(c("3", "diamonds"), new Set(["3"]), ctx())).toBe(false);
  });

  it("is a black three only when black threes are in play: from the foot, onto their book", () => {
    expect(canLayOff(c("3", "spades"), new Set(["3"]), ctx())).toBe(true);
    expect(canLayOff(c("3", "spades"), new Set(["3"]), ctx({ inFoot: false }))).toBe(false);
  });
});

describe("arrange", () => {
  const ace = card("A", "spades");
  const four = card("4", "hearts");
  const king = card("K", "clubs");
  const joker = card("JOKER", null);
  const two = card("2", "clubs");
  const ids = (cards: readonly Card[]): string[] => cards.map((c) => c.id);

  it("is the usual display order when the player has arranged nothing", () => {
    expect(ids(arrange([joker, king, four, ace], null))).toEqual(
      ids(sortForDisplay([joker, king, four, ace])),
    );
  });

  it("keeps the player's order for every card it names", () => {
    const order = [joker.id, ace.id, four.id, king.id];
    expect(ids(arrange([four, king, ace, joker], order))).toEqual(order);
  });

  it("puts cards it does not name at the right end, in display order", () => {
    // A draw, or the pile: where the "NEW" marker points.
    const order = [king.id, four.id];
    expect(ids(arrange([joker, four, ace, king, two], order))).toEqual([
      king.id,
      four.id,
      ace.id,
      two.id,
      joker.id,
    ]);
  });

  it("drops ids no longer held", () => {
    const order = [joker.id, "gone", ace.id, four.id];
    expect(ids(arrange([four, ace], order))).toEqual([ace.id, four.id]);
  });

  it("an empty order sorts everything as new", () => {
    expect(ids(arrange([king, ace, four], []))).toEqual([four.id, king.id, ace.id]);
  });

  it("never reorders the cards it was given", () => {
    const cards = [king, ace, four];
    arrange(cards, [four.id, ace.id, king.id]);
    expect(ids(cards)).toEqual([king.id, ace.id, four.id]);
  });
});

describe("moving a card", () => {
  const row = ["a", "b", "c", "d"];

  it("drops a card before the one at a slot, counted as the row was", () => {
    expect(moveTo(row, "a", 2)).toEqual(["b", "a", "c", "d"]);
    expect(moveTo(row, "d", 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveTo(row, "b", 0)).toEqual(["b", "a", "c", "d"]);
  });

  it("drops a card at the end for the slot past the last", () => {
    expect(moveTo(row, "a", 4)).toEqual(["b", "c", "d", "a"]);
  });

  it("changes nothing for the slots either side of the card itself", () => {
    expect(moveTo(row, "b", 1)).toEqual(row);
    expect(moveTo(row, "b", 2)).toEqual(row);
  });

  it("keeps a slot out of range inside the row", () => {
    expect(moveTo(row, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveTo(row, "c", -3)).toEqual(["c", "a", "b", "d"]);
  });

  it("leaves the row alone for a card not in it, and never changes its input", () => {
    expect(moveTo(row, "z", 0)).toEqual(row);
    expect(moveBy(row, "z", 1)).toEqual(row);
    moveTo(row, "a", 3);
    expect(row).toEqual(["a", "b", "c", "d"]);
  });

  it("moves one place left or right, staying put at either end", () => {
    expect(moveBy(row, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(moveBy(row, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveBy(row, "a", -1)).toEqual(row);
    expect(moveBy(row, "d", 1)).toEqual(row);
  });
});
