import { describe, it, expect } from "vitest";
import { isRed, isRedThree, isBlackThree, type Card, type Rank, type Suit } from "@hf/shared";
import { buildShoe } from "./deck";

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
