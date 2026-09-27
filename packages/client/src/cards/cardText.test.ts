import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "@hf/shared";
import { standardDeck } from "@hf/engine";
import { cardLabel, rankLabel, suitSymbol } from "./cardText";

const card = (rank: Rank, suit: Suit | null): Card => ({ id: `${rank}-${suit}`, rank, suit });

describe("suitSymbol", () => {
  it.each([
    ["clubs", "♣"],
    ["diamonds", "♦"],
    ["hearts", "♥"],
    ["spades", "♠"],
  ] as const)("draws %s as %s", (suit, glyph) => {
    expect(suitSymbol(suit)).toBe(glyph);
  });

  it("gives a suitless card a star", () => {
    // Jokers have no suit; a blank corner would read as a rendering fault.
    expect(suitSymbol(null)).toBe("★");
  });
});

describe("rankLabel", () => {
  it("shortens the joker to fit a corner", () => {
    expect(rankLabel("JOKER")).toBe("JKR");
  });

  it("leaves every other rank as it is", () => {
    expect(rankLabel("10")).toBe("10");
    expect(rankLabel("A")).toBe("A");
    expect(rankLabel("2")).toBe("2");
  });

  it("has a label for every rank in a real deck", () => {
    // Built from the engine's own deck rather than a list here, so a new rank could
    // not slip through with an empty corner.
    for (const real of standardDeck(0)) {
      expect(rankLabel(real.rank)).not.toBe("");
    }
  });
});

describe("cardLabel", () => {
  it("names an ordinary card", () => {
    expect(cardLabel(card("A", "spades"))).toBe("Ace of spades");
    expect(cardLabel(card("10", "hearts"))).toBe("Ten of hearts");
  });

  it("says when a card is wild", () => {
    // Wildness changes what the card can do, and no glyph conveys it.
    expect(cardLabel(card("2", "clubs"))).toBe("Two of clubs, wild");
    expect(cardLabel(card("JOKER", null))).toBe("Joker, wild");
  });

  it("distinguishes the two kinds of three", () => {
    // A red three is a penalty that can never be melded; a black three only melds
    // from the foot. Reading "Three of hearts" alone would hide both rules.
    expect(cardLabel(card("3", "hearts"))).toBe("Three of hearts, penalty");
    expect(cardLabel(card("3", "diamonds"))).toBe("Three of diamonds, penalty");
    expect(cardLabel(card("3", "spades"))).toBe("Three of spades, blocks the pile");
    expect(cardLabel(card("3", "clubs"))).toBe("Three of clubs, blocks the pile");
  });

  it("names a suitless non-joker without producing a gap", () => {
    // Unreachable through a real deck — only jokers lack a suit, and they return
    // earlier — but `Card.suit` is nullable, so the fallback is what stops the label
    // reading "Ace of null" if one were ever constructed by hand.
    expect(cardLabel({ id: "odd", rank: "A", suit: null })).toBe("Ace of no suit");
  });

  it("gives every card in a real deck a distinct, non-empty name", () => {
    // The tests find a specific card by its accessible name, so two cards sharing
    // one would make the table ambiguous to query and to hear.
    const labels = standardDeck(0).map(cardLabel);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    // 52 distinct faces plus one joker name shared by both jokers.
    expect(new Set(labels).size).toBe(53);
  });
});
