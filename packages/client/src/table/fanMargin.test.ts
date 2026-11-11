import { describe, it, expect } from "vitest";
import { fanMargin } from "./Hand";

describe("a watched hand's fan", () => {
  it("overlaps a fifth of each card when they all fit", () => {
    // Ten 46px cards in 600px: each step is 80% of a card.
    expect(fanMargin(600, 10, 46)).toBe(-9);
  });

  it("overlaps more to fit the width when it must", () => {
    // Twelve in 340px: (340 - 46) / 11 = 26.7 per card.
    expect(fanMargin(340, 12, 46)).toBe(-19);
    // Exactly the width, at the 80% step.
    expect(fanMargin(46 + 9 * 36.8, 10, 46)).toBe(-9);
  });

  it("always leaves a corner showing, however many cards", () => {
    // A third of 45px is 15 showing: the rest of the card is overlapped.
    expect(fanMargin(100, 30, 45)).toBe(-30);
  });

  it("has nothing to overlap with one card or none", () => {
    expect(fanMargin(300, 1, 46)).toBe(0);
    expect(fanMargin(300, 0, 46)).toBe(0);
  });
});
