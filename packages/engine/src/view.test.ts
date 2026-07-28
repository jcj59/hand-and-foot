import { describe, it, expect } from "vitest";
import { EAST_COAST, type Meld } from "@hf/shared";
import { deal } from "./deal";
import { project } from "./view";
import { buildShoe } from "./deck";

const meldCardCount = (melds: readonly Meld[]) =>
  melds.reduce((total, meld) => total + meld.cards.length, 0);

describe("project (per-player view)", () => {
  const state = deal(4, EAST_COAST, 55);
  const view = project(state, 0);

  it("shows the viewer their own hand in full", () => {
    expect(view.hand).toEqual(state.players[0].hand);
  });

  it("reduces every opponent to counts", () => {
    expect(view.opponents).toHaveLength(3);
    for (const opp of view.opponents) {
      expect(opp.handCount).toBe(14);
      expect(opp.footCount).toBe(14);
    }
  });

  it("never leaks another player's hidden cards (L6 view-security)", () => {
    const serialized = JSON.stringify(view);
    const foreignIds = state.players
      .slice(1)
      .flatMap((p) => [...p.hand, ...p.foot].map((c) => c.id));
    for (const id of foreignIds) {
      expect(serialized).not.toContain(id);
    }
  });

  it("hides the viewer's own foot until it is picked up", () => {
    expect(view.inFoot).toBe(false);
    expect(view.foot).toBeNull();
    expect(view.footCount).toBe(14);
  });

  it("exposes the stock as a count and the discard in full", () => {
    expect(typeof view.stockCount).toBe("number");
    expect("stock" in view).toBe(false);
    expect(view.discard).toEqual(state.discard);
  });

  it("accounts for every card in the shoe", () => {
    const total =
      view.hand.length +
      view.footCount +
      meldCardCount(view.melds) +
      view.opponents.reduce(
        (sum, opp) => sum + opp.handCount + opp.footCount + meldCardCount(opp.melds),
        0,
      ) +
      view.discard.length +
      view.stockCount;
    expect(total).toBe(buildShoe(4, EAST_COAST.extraDecks).length);
  });
});
