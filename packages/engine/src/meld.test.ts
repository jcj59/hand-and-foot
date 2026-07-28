import { describe, it, expect } from "vitest";
import { EAST_COAST, WEST_COAST, type Card, type Rank, type Suit } from "@hf/shared";
import { validateMeld, isValidMeld, countWilds, naturalRank } from "./meld";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `t${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number, suit: Suit = "clubs"): Card[] {
  return Array.from({ length: n }, () => card(rank, suit));
}

describe("countWilds / naturalRank", () => {
  it("counts 2s and jokers as wild and finds the natural rank", () => {
    const meld = [card("K"), card("K"), card("2"), card("JOKER")];
    expect(countWilds(meld)).toBe(2);
    expect(naturalRank(meld)).toBe("K");
    expect(naturalRank([card("2"), card("JOKER")])).toBeNull();
  });
});

describe("validateMeld", () => {
  it("accepts three natural cards of one rank", () => {
    expect(isValidMeld(cards("7", 3), EAST_COAST)).toBe(true);
  });

  it("accepts naturals outnumbering wilds under East Coast (4 naturals, 3 wilds)", () => {
    const meld = [...cards("K", 4), card("2"), card("2"), card("JOKER")];
    expect(isValidMeld(meld, EAST_COAST)).toBe(true);
  });

  it("treats the equal-wild case per config: valid West Coast, invalid East Coast", () => {
    const meld = [...cards("K", 3), card("2"), card("2"), card("JOKER")]; // 3 naturals, 3 wilds
    expect(isValidMeld(meld, WEST_COAST)).toBe(true);
    expect(isValidMeld(meld, EAST_COAST)).toBe(false);
  });

  it("rejects fewer than three cards", () => {
    const r = validateMeld(cards("9", 2), EAST_COAST);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/at least 3/);
  });

  it("rejects two different natural ranks", () => {
    const r = validateMeld([card("9"), card("9"), card("10")], EAST_COAST);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/one rank/);
  });

  it("rejects a meld made only of wilds", () => {
    const r = validateMeld([card("2"), card("2"), card("JOKER")], EAST_COAST);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/only wild/);
  });

  it("rejects wilds equal to naturals under East Coast (2 naturals, 2 wilds)", () => {
    const meld = [...cards("5", 2), card("2"), card("2")];
    expect(isValidMeld(meld, EAST_COAST)).toBe(false);
  });
});
