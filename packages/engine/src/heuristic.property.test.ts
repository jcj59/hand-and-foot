import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  EAST_COAST,
  WEST_COAST,
  type Card,
  type GameState,
  type RulesConfig,
  isRedThree,
} from "@hf/shared";
import { type Policy, defaultPolicy, heuristicPolicy, playMatch } from "./arena";
import { canTakePile } from "./feasibility";
import { MAX_PILE_RED_THREES } from "./policy";
import { prng, shuffle } from "./rng";

/**
 * Whole four-round matches are played per run — some 650 matches, 2,600 rounds,
 * across the first two properties — so allow for a loaded CI runner; see
 * `invariants.property.test.ts`.
 */
const PROPERTY_TIMEOUT_MS = 120_000;

/**
 * The same table with every card the seat cannot see dealt differently: the stock,
 * each other seat's hand and foot, and the seat's own foot until it is picked up
 * are pooled, shuffled, and handed back in the same counts. What the seat can see
 * is untouched, so a policy that plays from the seat's view must not notice.
 */
function reshuffleHidden(state: GameState, seat: number, seed: number): GameState {
  const hidden: Card[] = [...state.stock];
  state.players.forEach((p, i) => {
    if (i !== seat) hidden.push(...p.hand);
    if (i !== seat || !p.inFoot) hidden.push(...p.foot);
  });
  const pool = shuffle(hidden, prng(seed));
  let next = 0;
  const take = (n: number): Card[] => pool.slice(next, (next += n));
  const players = state.players.map((p, i) => ({
    ...p,
    hand: i === seat ? p.hand : take(p.hand.length),
    foot: i === seat && p.inFoot ? p.foot : take(p.foot.length),
  }));
  return { ...state, players, stock: take(state.stock.length) };
}

/**
 * The heuristic, checked at every decision it makes: that it never reads a card
 * its seat cannot see, and that it turns down a pile it could take only for the
 * reason it gives. (That the reducer accepts every move is `playMatch`'s own
 * check: it throws on a refused one.)
 */
function checked(seed: number): Policy {
  let decisions = 0;
  return (state, seat) => {
    const action = heuristicPolicy(state, seat);
    // A sample is enough to catch a policy that peeks; every decision would double
    // the cost of the property.
    if (decisions++ % 7 === 0) {
      expect(heuristicPolicy(reshuffleHidden(state, seat, seed + decisions), seat)).toEqual(action);
    }
    if (action?.type === "draw" && canTakePile(state, seat).feasible) {
      expect(state.discard.filter(isRedThree).length).toBeGreaterThan(MAX_PILE_RED_THREES);
    }
    return action;
  };
}

const presets: readonly RulesConfig[] = [EAST_COAST, WEST_COAST];

describe("heuristicAction over whole matches", () => {
  it(
    "only ever proposes moves the reducer accepts, at every table size and preset",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          fc.integer({ min: 2, max: 6 }),
          fc.constantFrom(...presets),
          (seed, players, config) => {
            const policies = Array.from({ length: players }, () => checked(seed));
            playMatch(policies, config, seed);
          },
        ),
        { numRuns: 500 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    "only ever proposes moves the reducer accepts beside default seats",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          fc.integer({ min: 2, max: 4 }),
          fc.integer({ min: 0, max: 3 }),
          (seed, players, at) => {
            const policies = Array.from({ length: players }, (_, i) =>
              i === at % players ? checked(seed) : defaultPolicy,
            );
            // A table this one-sided can stall; a short limit keeps the run cheap
            // without hiding anything, since every move up to it is still checked.
            playMatch(policies, EAST_COAST, seed, 1_500);
          },
        ),
        { numRuns: 150 },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  it(
    "ends its rounds: tables of heuristic seats go out where tables of defaults never do",
    () => {
      let played = 0;
      let ended = 0;
      let wentOut = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const players = 2 + (seed % 3);
        const result = playMatch(Array<Policy>(players).fill(heuristicPolicy), EAST_COAST, seed);
        played += result.complete ? EAST_COAST.rounds : result.roundsEnded + 1;
        ended += result.roundsEnded;
        wentOut += result.wentOut.filter((s) => s !== null).length;
      }
      // 1,200 rounds. A round can still deadlock — every card that could finish a
      // missing book already melded — so this is a rate, not every round; see
      // CLAUDE.md. Measured: all but one end, every one of those by going out.
      expect(ended / played).toBeGreaterThan(0.99);
      expect(wentOut).toBe(ended);
    },
    PROPERTY_TIMEOUT_MS,
  );
});
