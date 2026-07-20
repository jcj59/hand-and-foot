import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { EAST_COAST, type Action, type GameState } from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";
import { prng } from "./rng";

function allCardIds(state: GameState): string[] {
  const ids: string[] = [];
  for (const p of state.players) {
    for (const c of p.hand) ids.push(c.id);
    for (const c of p.foot) ids.push(c.id);
    for (const m of p.melds) for (const c of m.cards) ids.push(c.id);
  }
  for (const c of state.stock) ids.push(c.id);
  for (const c of state.discard) ids.push(c.id);
  return ids;
}

/** A cheap random-but-legal move: draw in the draw phase, discard in the play phase. */
function pick(state: GameState, rand: () => number): Action {
  if (state.phase === "draw") return { type: "draw" };
  const p = state.players[state.currentSeat];
  const zone = p.inFoot ? p.foot : p.hand;
  return { type: "discard", cardId: zone[Math.floor(rand() * zone.length)].id };
}

describe("engine invariants (property-based)", () => {
  it("conserves every card across random legal play, with no duplication or loss", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          let state = deal(players, EAST_COAST, seed);
          const shoeSize = allCardIds(state).length;
          const rand = prng(seed);
          for (let step = 0; step < 300 && !state.roundEnded; step++) {
            const r = applyAction(state, pick(state, rand));
            if (!r.ok) break;
            state = r.state;
            const ids = allCardIds(state);
            expect(ids.length).toBe(shoeSize);
            expect(new Set(ids).size).toBe(shoeSize);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("keeps the state well-formed after every accepted action", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        let state = deal(4, EAST_COAST, seed);
        const rand = prng(seed + 1);
        for (let step = 0; step < 200 && !state.roundEnded; step++) {
          const r = applyAction(state, pick(state, rand));
          if (!r.ok) break;
          state = r.state;
          expect(state.currentSeat).toBeGreaterThanOrEqual(0);
          expect(state.currentSeat).toBeLessThan(state.players.length);
          expect(["draw", "play", "discard"]).toContain(state.phase);
        }
      }),
      { numRuns: 40 },
    );
  });
});
