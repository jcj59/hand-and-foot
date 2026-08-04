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

  // The opening flip is a house rule. With it off, no card starts the pile and the
  // card that would have been flipped stays in the stock instead.
  it("starts with an empty pile when initialDiscardFlip is off", () => {
    const config = { ...EAST_COAST, initialDiscardFlip: false };
    const state = deal(4, config, 123);

    expect(state.discard).toHaveLength(0);

    const shoe = buildShoe(4, config.extraDecks);
    expect(state.stock).toHaveLength(shoe.length - 4 * 28);
    expect(state.stock).toHaveLength(deal(4, EAST_COAST, 123).stock.length + 1);

    const all: Card[] = [
      ...state.players.flatMap((p) => [...p.hand, ...p.foot]),
      ...state.discard,
      ...state.stock,
    ];
    expect(all.map((c) => c.id).sort()).toEqual(shoe.map((c) => c.id).sort());
  });

  // Every size the deal uses comes from the config, so a config that shares no
  // numbers with EAST_COAST proves nothing is hard-coded.
  it("takes every size from the config rather than from constants", () => {
    const config = { ...EAST_COAST, extraDecks: 0, handSize: 11, footSize: 13 };
    const state = deal(3, config, 5);

    for (const p of state.players) {
      expect(p.hand).toHaveLength(11);
      expect(p.foot).toHaveLength(13);
    }

    // extraDecks: 0 means one deck per player, not the default player count + 1.
    const shoe = buildShoe(3, 0);
    expect(shoe).toHaveLength(3 * 54);
    expect(state.stock).toHaveLength(shoe.length - 3 * 24 - 1);

    const all: Card[] = [
      ...state.players.flatMap((p) => [...p.hand, ...p.foot]),
      ...state.discard,
      ...state.stock,
    ];
    expect(all.map((c) => c.id).sort()).toEqual(shoe.map((c) => c.id).sort());
  });

  it("carries the config and seed it was dealt with into the state", () => {
    const config = { ...EAST_COAST, handSize: 11 };
    const state = deal(2, config, 4242);
    expect(state.config).toBe(config);
    expect(state.seed).toBe(4242);
    expect(state.roundEnded ?? false).toBe(false);
    expect(state.wentOutSeat).toBeUndefined();
  });

  it("deals different openings for different seeds", () => {
    const a = deal(4, EAST_COAST, 1).players[0].hand.map((c) => c.id);
    const b = deal(4, EAST_COAST, 2).players[0].hand.map((c) => c.id);
    expect(a).not.toEqual(b);
  });

  it("deals every player a disjoint hand and foot", () => {
    const state = deal(6, EAST_COAST, 31);
    const seen = new Set<string>();
    for (const p of state.players) {
      for (const c of [...p.hand, ...p.foot]) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
    }
    expect(seen.size).toBe(6 * 28);
  });

  it("deals the same hands and feet whether or not the opening card is flipped", () => {
    const flipped = deal(4, EAST_COAST, 77);
    const unflipped = deal(4, { ...EAST_COAST, initialDiscardFlip: false }, 77);
    expect(unflipped.players).toEqual(flipped.players);
    // The flipped card is exactly the next card off the shoe.
    expect(unflipped.stock[0]).toEqual(flipped.discard[0]);
  });
});
