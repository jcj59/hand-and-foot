import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "@hf/shared";
import { standardDeck } from "@hf/engine";
import {
  compareForDisplay,
  displayGroup,
  isDeadWeight,
  isRedCard,
  sortForDisplay,
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
