import { describe, it, expect } from "vitest";
import { EAST_COAST, type Card } from "@hf/shared";
import { deal } from "./deal";
import { buildShoe } from "./deck";

describe("deal", () => {
  for (const playerCount of [2, 4, 8]) {
    it(`deals ${playerCount} players a valid opening state`, () => {
      const state = deal(playerCount, EAST_COAST, 123);

      expect(state.players).toHaveLength(playerCount);
      for (const p of state.players) {
        expect(p.hand).toHaveLength(14);
        expect(p.foot).toHaveLength(14);
        expect(p.melds).toHaveLength(0);
        expect(p.isDown).toBe(false);
        expect(p.inFoot).toBe(false);
        expect(p.footPending).toBe(false);
      }

      expect(state.discard).toHaveLength(1);
      expect(state.phase).toBe("draw");
      expect(state.currentSeat).toBe(0);
      expect(state.roundNumber).toBe(1);

      const shoe = buildShoe(playerCount, EAST_COAST.extraDecks);
      expect(state.stock).toHaveLength(shoe.length - playerCount * 28 - 1);

      // Conservation: every card in the shoe appears exactly once across all zones.
      const all: Card[] = [
        ...state.players.flatMap((p) => [...p.hand, ...p.foot]),
        ...state.discard,
        ...state.stock,
      ];
      expect(all).toHaveLength(shoe.length);
      expect(all.map((c) => c.id).sort()).toEqual(shoe.map((c) => c.id).sort());
    });
  }

  it("is deterministic for a fixed seed", () => {
    expect(deal(4, EAST_COAST, 99)).toEqual(deal(4, EAST_COAST, 99));
  });
});
