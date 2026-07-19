import { describe, it, expect } from "vitest";
import { isWild, EAST_COAST, WEST_COAST } from "./index";

describe("wild cards", () => {
  it("treats 2s and jokers as wild, everything else as natural", () => {
    expect(isWild("2")).toBe(true);
    expect(isWild("JOKER")).toBe(true);
    expect(isWild("K")).toBe(false);
    expect(isWild("A")).toBe(false);
  });
});

describe("rule presets", () => {
  it("East Coast requires naturals to exceed wilds and 1 clean + 2 dirty to go out", () => {
    expect(EAST_COAST.wildRatio).toBe("naturals-exceed-wilds");
    expect(EAST_COAST.goOutCleanBooks).toBe(1);
    expect(EAST_COAST.goOutDirtyBooks).toBe(2);
  });

  it("West Coast differs only by allowing wilds to equal naturals", () => {
    expect(WEST_COAST.wildRatio).toBe("naturals-equal-wilds");
    expect(WEST_COAST.goOutCleanBooks).toBe(EAST_COAST.goOutCleanBooks);
    expect(WEST_COAST.handSize).toBe(EAST_COAST.handSize);
  });
});
