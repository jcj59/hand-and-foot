import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  EAST_COAST,
  type Action,
  type GameState,
  type MeldPlay,
  type PlayerView,
} from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";
import { prng } from "./rng";
import { canTakePile } from "./feasibility";
import { naturalRank, validateMeld } from "./meld";
import { defaultAction } from "./policy";
import { project } from "./view";

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

/**
 * Play a random game that exercises all four actions, not just draw and discard.
 * In the draw phase it sometimes takes the pile, keeping the solver's witness plan
 * so the resulting obligation can be settled on the next step; otherwise it draws.
 * `onState` sees every state the game passes through.
 *
 * Submitting the witness plan is asserted to succeed: that is the solver's
 * soundness guarantee, checked here against thousands of real positions rather
 * than the handful a unit test can build.
 */
function playRandomGame(
  seed: number,
  players: number,
  maxSteps: number,
  onState?: (state: GameState) => void,
): { state: GameState; actions: Action[]; tookPile: number } {
  let state = deal(players, EAST_COAST, seed);
  const rand = prng(seed + 7777);
  const actions: Action[] = [];
  let pendingPlan: readonly MeldPlay[] | null = null;
  let tookPile = 0;

  for (let step = 0; step < maxSteps && !state.roundEnded; step++) {
    let action: Action;
    if (state.phase === "draw") {
      const f = rand() < 0.7 ? canTakePile(state, state.currentSeat) : { feasible: false as const };
      if (f.feasible && f.plan && f.plan.length > 0) {
        pendingPlan = f.plan;
        action = { type: "takePile" };
      } else {
        action = { type: "draw" };
      }
    } else if (pendingPlan) {
      action = { type: "playMelds", melds: pendingPlan };
    } else {
      const p = state.players[state.currentSeat];
      const zone = p.inFoot ? p.foot : p.hand;
      if (zone.length === 0) break;
      action = { type: "discard", cardId: zone[Math.floor(rand() * zone.length)].id };
    }

    const r = applyAction(state, action);
    if (action.type === "playMelds") {
      // The solver promised this lay-down was completable.
      expect(r.ok, `witness plan rejected on seed ${seed}: ${r.ok ? "" : r.error}`).toBe(true);
      pendingPlan = null;
    }
    if (action.type === "takePile" && r.ok) tookPile++;
    if (!r.ok) break;
    actions.push(action);
    state = r.state;
    onState?.(state);
  }
  return { state, actions, tookPile };
}

/**
 * Structural rules that must hold of any state the reducer produces. Violations are
 * collected and asserted once, because a per-card expect() across whole games costs
 * millions of calls.
 */
function assertWellFormed(state: GameState, seed: number): void {
  const bad: string[] = [];
  if (state.currentSeat < 0 || state.currentSeat >= state.players.length) {
    bad.push(`currentSeat ${state.currentSeat} out of range`);
  }
  if (!["draw", "play"].includes(state.phase)) bad.push(`bad phase ${state.phase}`);

  // A final lap counts down to zero and ends the round there; it must never run
  // past it into negative territory.
  if (state.finalLapRemaining !== undefined && state.finalLapRemaining < 0) {
    bad.push(`finalLapRemaining went negative (${state.finalLapRemaining})`);
  }
  // A final lap is only ever running because somebody went out without a discard.
  if (state.finalLapRemaining !== undefined && state.wentOutSeat === undefined) {
    bad.push("a final lap is running with nobody having gone out");
  }
  if (state.wentOutSeat !== undefined) {
    const winner = state.players[state.wentOutSeat];
    if (winner === undefined) bad.push(`wentOutSeat ${state.wentOutSeat} out of range`);
    // Going out means shedding every card, so the winner holds nothing from then on.
    else if (winner.hand.length + winner.foot.length > 0) {
      bad.push(`seat ${state.wentOutSeat} went out but still holds cards`);
    }
  }

  for (const [seat, p] of state.players.entries()) {
    // One meld per rank per player, and every meld structurally legal.
    const ranks = p.melds.map((m) => m.rank);
    if (new Set(ranks).size !== ranks.length) bad.push(`seat ${seat} has two melds of one rank`);
    for (const m of p.melds) {
      if (!validateMeld(m.cards, state.config).valid) {
        bad.push(`seat ${seat} holds an invalid ${m.rank} meld`);
      }
      if (naturalRank(m.cards) !== m.rank) {
        bad.push(`seat ${seat} meld labelled ${m.rank} but natural rank differs`);
      }
    }
    // Melds only exist once a player is down.
    if (p.melds.length > 0 && !p.isDown) bad.push(`seat ${seat} has melds without being down`);
    // A pile obligation only ever belongs to the player currently acting.
    if ((p.pickedUp ?? []).length > 0 && seat !== state.currentSeat) {
      bad.push(`seat ${seat} owes a pile play but is not the acting seat`);
    }
    // The hand is emptied before the foot is ever taken up.
    if (p.inFoot && p.hand.length > 0) bad.push(`seat ${seat} is in its foot holding hand cards`);
  }
  expect(bad, `seed ${seed}`).toEqual([]);
}

/** Every card id a projected view exposes to its holder. */
function visibleIds(view: PlayerView): Set<string> {
  const ids = new Set<string>();
  for (const c of view.hand) ids.add(c.id);
  for (const c of view.foot ?? []) ids.add(c.id);
  for (const m of view.melds) for (const c of m.cards) ids.add(c.id);
  for (const o of view.opponents) for (const m of o.melds) for (const c of m.cards) ids.add(c.id);
  for (const c of view.discard) ids.add(c.id);
  return ids;
}

/**
 * No player's view may expose another player's hidden cards or the stock. This is
 * the structural form of the check, cheap enough to run on every state of every
 * game; `view.test.ts` serializes whole views to catch anything the field-by-field
 * walk would miss.
 */
function assertNoLeak(state: GameState): void {
  const leaks: string[] = [];
  for (let seat = 0; seat < state.players.length; seat++) {
    const visible = visibleIds(project(state, seat));
    for (let other = 0; other < state.players.length; other++) {
      if (other === seat) continue;
      for (const c of [...state.players[other].hand, ...state.players[other].foot]) {
        if (visible.has(c.id)) leaks.push(`seat ${seat} sees ${c.id} held by seat ${other}`);
      }
    }
    for (const c of state.stock) {
      if (visible.has(c.id)) leaks.push(`seat ${seat} sees stock card ${c.id}`);
    }
  }
  // One assertion per state: a per-card expect() here costs millions of calls.
  expect(leaks).toEqual([]);
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
          expect(["draw", "play"]).toContain(state.phase);
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe("engine invariants under play that takes the pile", () => {
  it("conserves every card when takePile and playMelds are in the mix", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          const opening = deal(players, EAST_COAST, seed);
          const shoeSize = allCardIds(opening).length;
          playRandomGame(seed, players, 300, (state) => {
            const ids = allCardIds(state);
            expect(ids.length).toBe(shoeSize);
            expect(new Set(ids).size).toBe(shoeSize);
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  it("keeps every state structurally well-formed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          playRandomGame(seed, players, 300, (state) => assertWellFormed(state, seed));
        },
      ),
      { numRuns: 60 },
    );
  });

  it("actually reaches the pile often enough for these runs to mean something", () => {
    let totalTakes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      totalTakes += playRandomGame(seed, 4, 300).tookPile;
    }
    // Guards against the policy silently never taking the pile, which would make
    // the properties above a re-run of the draw/discard case.
    expect(totalTakes).toBeGreaterThan(20);
  });
});

describe("the default policy (property-based)", () => {
  /**
   * The guarantee the server leans on: whatever position a player is abandoned
   * in, there is a move to make on their behalf. A default that is merely
   * *usually* legal is worse than none, because the one position it cannot
   * handle is a wedged table with no way forward.
   */
  it("offers an action the reducer accepts at every state of a random game", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          const check = (state: GameState): void => {
            if (state.roundEnded) {
              expect(defaultAction(state)).toBeNull();
              return;
            }
            const action = defaultAction(state);
            expect(action, `no default available on seed ${seed}`).not.toBeNull();
            const r = applyAction(state, action as Action);
            expect(r.ok, `default rejected on seed ${seed}: ${r.ok ? "" : r.error}`).toBe(true);
          };
          check(deal(players, EAST_COAST, seed));
          // playRandomGame reaches take-pile positions, so this also covers the
          // states where a discard is refused until the obligation is settled.
          playRandomGame(seed, players, 200, check);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("never hands an absent player the pile, and so never a fresh obligation", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        playRandomGame(seed, 4, 200, (state) => {
          if (state.phase === "draw" && !state.roundEnded) {
            expect(defaultAction(state)).toEqual({ type: "draw" });
          }
        });
      }),
      { numRuns: 25 },
    );
  });

  /**
   * A table where every seat is on the default: the shape of a room whose players
   * have all dropped. The policy stays legal and the state stays sound for as long
   * as it runs, which is the guarantee the server needs.
   *
   * It also pins the limitation, because it is load-bearing: **an all-default table
   * never ends the round.** The policy only melds to discharge a take-pile
   * obligation, so nobody gets down, no books complete, nobody goes out, and the
   * stock reshuffles out of the discard pile indefinitely. That is the right call
   * for a timeout — laying a player's cards down while they are gone commits them
   * to a position they never chose — but it means the server cannot rely on a
   * round ending on its own, and an abandoned room has to be reaped explicitly.
   */
  it("stays legal indefinitely with every seat defaulting, without ending the round", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          let state = deal(players, EAST_COAST, seed);
          const shoeSize = allCardIds(state).length;
          let steps = 0;
          for (; steps < 1500 && !state.roundEnded; steps++) {
            const action = defaultAction(state);
            expect(action, `stuck at step ${steps} on seed ${seed}`).not.toBeNull();
            const r = applyAction(state, action as Action);
            expect(r.ok, `illegal at step ${steps} on seed ${seed}`).toBe(true);
            if (!r.ok) return;
            state = r.state;
            assertWellFormed(state, seed);
            const ids = allCardIds(state);
            expect(new Set(ids).size).toBe(shoeSize);
          }
          // Long past the point a played-out round would have finished.
          expect(state.roundEnded ?? false, `seed ${seed} ended unexpectedly`).toBe(false);
          expect(steps).toBe(1500);
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe("view security (property-based)", () => {
  it("never leaks a hidden card or the stock to any seat, at any point in a game", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 4 }),
        (seed, players) => {
          assertNoLeak(deal(players, EAST_COAST, seed));
          playRandomGame(seed, players, 120, assertNoLeak);
        },
      ),
      { numRuns: 25 },
    );
  });
});
