import { describe, it, expect } from "vitest";
import { isRed, isRedThree, isBlackThree, type Card, type Rank, type Suit } from "@hf/shared";
import { buildShoe, standardDeck } from "./deck";

describe("standardDeck", () => {
  it("is 52 suited cards plus 2 jokers", () => {
    const deck = standardDeck(3);
    expect(deck).toHaveLength(54);
    const jokers = deck.filter((c) => c.rank === "JOKER");
    expect(jokers).toHaveLength(2);
    // A joker has no suit; every other card does.
    for (const j of jokers) expect(j.suit).toBeNull();
    expect(deck.filter((c) => c.suit !== null)).toHaveLength(52);
  });

  it("has exactly four of every suited rank and one of each suit-rank pair", () => {
    const deck = standardDeck(0);
    const suited = deck.filter((c) => c.suit !== null);
    const ranks = new Set(suited.map((c) => c.rank));
    expect(ranks.size).toBe(13);
    for (const rank of ranks) {
      expect(suited.filter((c) => c.rank === rank)).toHaveLength(4);
    }
    const pairs = suited.map((c) => `${c.suit}-${c.rank}`);
    expect(new Set(pairs).size).toBe(52);
  });

  it("namespaces ids by deck index so a shoe never repeats one", () => {
    const deck = standardDeck(3);
    for (const c of deck) expect(c.id.startsWith("d3-")).toBe(true);
    expect(new Set(deck.map((c) => c.id)).size).toBe(54);
    // The same card in a different deck is a different id.
    expect(new Set(standardDeck(4).map((c) => c.id))).not.toContain(deck[0].id);
  });
});

describe("buildShoe", () => {
  it("has (playerCount + 1) * 54 cards by default", () => {
    expect(buildShoe(2)).toHaveLength(162);
    expect(buildShoe(7)).toHaveLength(432);
  });

  it("has the correct composition", () => {
    const shoe = buildShoe(3); // 4 decks
    expect(shoe.filter((c) => c.rank === "JOKER")).toHaveLength(8); // 4 decks * 2 jokers
    expect(shoe.filter((c) => c.rank === "K")).toHaveLength(16); // 4 decks * 4 kings
    for (const suit of ["clubs", "diamonds", "hearts", "spades"] as const) {
      expect(shoe.filter((c) => c.suit === suit)).toHaveLength(52); // 4 decks * 13 ranks
    }
  });

  it("gives every card a unique id", () => {
    const ids = buildShoe(8).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("honours extraDecks, including none", () => {
    expect(buildShoe(4, 0)).toHaveLength(4 * 54);
    expect(buildShoe(4, 1)).toHaveLength(5 * 54);
    expect(buildShoe(4, 3)).toHaveLength(7 * 54);
  });

  it("is a fresh array of cards on every call", () => {
    const a = buildShoe(2);
    const b = buildShoe(2);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });
});

describe("card color helpers", () => {
  const card = (rank: Rank, suit: Suit | null): Card => ({ id: "x", rank, suit });

  it("classifies color and the special threes", () => {
    expect(isRed(card("K", "hearts"))).toBe(true);
    expect(isRed(card("K", "spades"))).toBe(false);
    expect(isRedThree(card("3", "hearts"))).toBe(true);
    expect(isRedThree(card("3", "diamonds"))).toBe(true);
    expect(isRedThree(card("3", "spades"))).toBe(false);
    expect(isBlackThree(card("3", "clubs"))).toBe(true);
    expect(isBlackThree(card("3", "spades"))).toBe(true);
    expect(isBlackThree(card("3", "hearts"))).toBe(false);
  });
});
