import { describe, it, expect } from "vitest";
import { EAST_COAST, type Card, type Rank, type Suit } from "@hf/shared";
import { heldBreakdown, heldCost, redThreePenalty } from "./heldBreakdown";

const card = (rank: Rank, suit: Suit | null, n = 0): Card => ({
  id: `${rank}-${suit}-${n}`,
  rank,
  suit,
});

describe("what a held card costs", () => {
  it("is the size of its value, as a loss", () => {
    expect(heldCost(card("K", "spades"), EAST_COAST)).toBe(-10);
    expect(heldCost(card("3", "hearts"), EAST_COAST)).toBe(-500);
    expect(heldCost(card("3", "clubs"), EAST_COAST)).toBe(-5);
  });

  it("splits hand, foot and red threes so the three add up to the total", () => {
    const d = heldBreakdown(
      {
        seat: 0,
        hand: [card("A", "spades"), card("3", "diamonds")],
        foot: [card("2", "clubs"), card("3", "hearts"), card("8", "hearts")],
        footUntouched: true,
      },
      EAST_COAST,
    );
    expect(d.hand.cards.map((c) => c.card.rank)).toEqual(["A"]);
    expect(d.hand.sum).toBe(-15);
    expect(d.foot.cards.map((c) => c.cost)).toEqual([-20, -5]);
    expect(d.foot.sum).toBe(-25);
    expect(d.redThrees.cards.map((c) => c.card.id)).toEqual(["3-diamonds-0", "3-hearts-0"]);
    expect(d.redThrees.sum).toBe(-1000);
    expect(d.footUntouched).toBe(true);
    expect(d.count).toBe(5);
    expect(d.total).toBe(-1040);
  });

  it("charges red threes at the table's value, and nothing for none", () => {
    expect(redThreePenalty(0, EAST_COAST)).toBe(0);
    expect(Object.is(redThreePenalty(0, EAST_COAST), 0)).toBe(true);
    expect(redThreePenalty(2, EAST_COAST)).toBe(-1000);
    const cheap = { ...EAST_COAST, scoring: { ...EAST_COAST.scoring, redThree: -300 } };
    expect(redThreePenalty(1, cheap)).toBe(-300);
  });
});
