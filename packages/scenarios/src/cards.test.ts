import { describe, it, expect } from "vitest";
import type { Card } from "@hf/shared";
import { matches, parseCard, parseCards, takeCards } from "./cards";

describe("card notation", () => {
  it("reads ranks, suits and jokers, in either case", () => {
    expect(parseCard("KH")).toEqual({ rank: "K", suit: "hearts", text: "KH" });
    expect(parseCard("10s")).toEqual({ rank: "10", suit: "spades", text: "10S" });
    expect(parseCard("3D")).toEqual({ rank: "3", suit: "diamonds", text: "3D" });
    expect(parseCard("2c").suit).toBe("clubs");
    expect(parseCard(" jk ")).toEqual({ rank: "JOKER", suit: null, text: "JK" });
    expect(parseCards("  KH   2C\nJK ").map((c) => c.text)).toEqual(["KH", "2C", "JK"]);
    expect(parseCards("")).toEqual([]);
  });

  it("refuses anything that is not a card, rather than guessing", () => {
    for (const bad of ["K", "KX", "1H", "11S", "ZH", "JOKER", "H"]) {
      expect(() => parseCard(bad)).toThrow(/is not a card/);
    }
  });

  it("takes the first match of each card named, and says which it could not find", () => {
    const pool: Card[] = [
      { id: "a", rank: "K", suit: "hearts" },
      { id: "b", rank: "K", suit: "hearts" },
      { id: "c", rank: "JOKER", suit: null },
    ];
    expect(matches(pool[0]!, parseCard("KH"))).toBe(true);
    expect(matches(pool[0]!, parseCard("KS"))).toBe(false);
    const { taken, rest } = takeCards(pool, parseCards("KH JK"), "here");
    expect(taken.map((c) => c.id)).toEqual(["a", "c"]);
    expect(rest.map((c) => c.id)).toEqual(["b"]);
    expect(() => takeCards(pool, parseCards("KH KH KH"), "in the hand")).toThrow(
      "no KH in the hand",
    );
  });
});
