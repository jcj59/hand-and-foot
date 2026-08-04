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

  it("skips leading wilds to find the natural rank", () => {
    expect(naturalRank([card("2"), card("JOKER"), card("9"), card("9")])).toBe("9");
  });

  // `validateMeld` rejects mixed naturals, so a caller only ever sees this on an
  // invalid meld. `applyPlayMelds` still calls it there to name the offending rank
  // in its error, so pin *which* rank it names: the first natural, in card order.
  it("reports the first natural rank when the cards disagree", () => {
    expect(naturalRank([card("K"), card("9")])).toBe("K");
    expect(naturalRank([card("9"), card("K")])).toBe("9");
  });

  it("counts no wilds in an all-natural meld", () => {
    expect(countWilds(cards("K", 3))).toBe(0);
    expect(countWilds([])).toBe(0);
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

  it("rejects wilds outnumbering naturals under West Coast (2 naturals, 3 wilds)", () => {
    const meld = [...cards("5", 2), card("2"), card("2"), card("JOKER")];
    const r = validateMeld(meld, WEST_COAST);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/West Coast/);
  });

  it("accepts a large meld under either preset when naturals dominate", () => {
    const meld = [...cards("8", 5), card("2"), card("JOKER")];
    expect(isValidMeld(meld, EAST_COAST)).toBe(true);
    expect(isValidMeld(meld, WEST_COAST)).toBe(true);
  });
});
