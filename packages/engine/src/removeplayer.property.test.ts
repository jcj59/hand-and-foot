import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { EAST_COAST, WEST_COAST, type GameState, type RulesConfig } from "@hf/shared";
import { deal } from "./deal";
import { buildShoe } from "./deck";
import { isMatchOver, matchTotals } from "./nextRound";
import { defaultAction } from "./policy";
import { applyAction } from "./reducer";
import { prng } from "./rng";
import { isSeated, seatedCount } from "./seats";
import { project } from "./view";

/** Short rounds, so a whole match of defaults ends: no extra decks, and the stock running out ends the round. */
const short = (config: RulesConfig): RulesConfig => ({
  ...config,
  extraDecks: 0,
  stockExhaustion: "end",
});

function cardsIn(state: GameState): number {
  return (
    state.stock.length +
    state.discard.length +
    state.players.reduce(
      (n, p) =>
        n + p.hand.length + p.foot.length + p.melds.reduce((m, meld) => m + meld.cards.length, 0),
      0,
    )
  );
}

/**
 * A whole match where, between rounds, players leave at random — as many as the
 * table allows — checking after every action that the departed are out of play
 * and that the deal was for the players still in it.
 */
function playMatchWithLeavers(seed: number, playerCount: number, config: RulesConfig): GameState {
  const rand = prng(seed ^ 0x5bd1e995);
  let state = deal(playerCount, config, seed);
  let shoe = buildShoe(playerCount, config.extraDecks).length;
  for (let guard = 0; ; guard++) {
    expect(guard).toBeLessThan(20_000);
    if (state.roundEnded) {
      if (isMatchOver(state)) return state;
      // Each seat still in leaves with a chance of one in three; the engine refuses
      // whoever would leave too few.
      for (let seat = 0; seat < playerCount; seat++) {
        if (!isSeated(state, seat) || rand() >= 1 / 3) continue;
        const r = applyAction(state, { type: "removePlayer", seat });
        if (seatedCount(state) > 2) expect(r.ok).toBe(true);
        else expect(r.ok).toBe(false);
        if (r.ok) state = r.state;
      }
      const totals = matchTotals(state);
      const r = applyAction(state, { type: "nextRound" });
      if (!r.ok) throw new Error(r.error);
      state = r.state;
      shoe = buildShoe(seatedCount(state), config.extraDecks).length;
      // Nobody's total changes for being dealt out.
      expect(matchTotals({ ...state, roundEnded: false })).toEqual(totals);
    } else {
      const action = defaultAction(state)!;
      const r = applyAction(state, action);
      if (!r.ok) throw new Error(r.error);
      state = r.state;
    }
    expect(cardsIn(state)).toBe(shoe);
    expect(isSeated(state, state.currentSeat)).toBe(true);
    for (const { seat } of state.departed ?? []) {
      const p = state.players[seat]!;
      // From the deal after they left, a departed seat holds nothing and is seen by nobody.
      if (state.roundNumber > state.departed!.find((d) => d.seat === seat)!.afterRound) {
        expect(p.hand.length + p.foot.length + p.melds.length).toBe(0);
      }
      for (let viewer = 0; viewer < playerCount; viewer++) {
        if (!isSeated(state, viewer)) continue;
        expect(project(state, viewer).opponents.some((o) => o.seat === seat)).toBe(false);
      }
    }
  }
}

describe("players leaving between rounds (property-based)", { timeout: 120_000 }, () => {
  it("keeps the departed out of play, the shoe the size of the table, and the totals", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.integer({ min: 3, max: 6 }),
        fc.boolean(),
        (seed, players, east) => {
          const end = playMatchWithLeavers(seed, players, short(east ? EAST_COAST : WEST_COAST));
          expect(seatedCount(end)).toBeGreaterThanOrEqual(2);
        },
      ),
      { numRuns: 40 },
    );
  });
});
