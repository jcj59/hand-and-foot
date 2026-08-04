import { describe, it, expect } from "vitest";
import { EAST_COAST, type Card, type Meld, type Rank, type Suit } from "@hf/shared";
import { cardValue, classifyBook, meldPoints } from "./scoring";
import { buildShoe } from "./deck";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `s${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function meld(cards: Card[]): Meld {
  const natural = cards.find((c) => c.rank !== "2" && c.rank !== "JOKER");
  return { rank: natural ? natural.rank : "2", cards };
}

describe("cardValue", () => {
  it("scores each card per the table", () => {
    expect(cardValue(card("JOKER"), EAST_COAST)).toBe(50);
    expect(cardValue(card("2"), EAST_COAST)).toBe(20);
    expect(cardValue(card("A"), EAST_COAST)).toBe(15);
    expect(cardValue(card("K"), EAST_COAST)).toBe(10);
    expect(cardValue(card("10"), EAST_COAST)).toBe(10);
    expect(cardValue(card("9"), EAST_COAST)).toBe(5);
    expect(cardValue(card("4"), EAST_COAST)).toBe(5);
    expect(cardValue(card("3", "clubs"), EAST_COAST)).toBe(5); // black three
    expect(cardValue(card("3", "hearts"), EAST_COAST)).toBe(-500); // red three
  });

  it("scores every rank a real shoe can produce", () => {
    // No card built by buildShoe should fall through to the zero default.
    for (const c of buildShoe(2)) {
      expect(cardValue(c, EAST_COAST)).not.toBe(0);
    }
  });

  it("falls back to zero for a card no scoring rule covers", () => {
    // A suitless three cannot come out of buildShoe; this pins the defensive
    // default so an unrecognised card is worth 0 rather than NaN or undefined.
    expect(cardValue({ id: "odd", rank: "3", suit: null }, EAST_COAST)).toBe(0);
  });
});

describe("classifyBook", () => {
  it("recognizes clean, dirty, black-three, and incomplete books", () => {
    const naturalSeven = meld(Array.from({ length: 7 }, () => card("K")));
    expect(classifyBook(naturalSeven)).toBe("clean");

    const withWild = meld([...Array.from({ length: 6 }, () => card("K")), card("2")]);
    expect(classifyBook(withWild)).toBe("dirty");

    const blackThrees = meld(Array.from({ length: 7 }, () => card("3", "spades")));
    expect(classifyBook(blackThrees)).toBe("dirty");

    const six = meld(Array.from({ length: 6 }, () => card("K")));
    expect(classifyBook(six)).toBe("incomplete");
  });
});

describe("meldPoints", () => {
  it("sums card values (three kings plus a wild two)", () => {
    const m = meld([card("K"), card("K"), card("K"), card("2")]);
    expect(meldPoints(m, EAST_COAST)).toBe(50);
  });
});
