import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type BotLevel, type RulesConfig } from "@hf/shared";
import {
  STANDARD_PILE_SHARE,
  heuristicPolicy,
  levelPolicy,
  pileCoin,
  playMatch,
  type Policy,
} from "./arena";
import { deal } from "./deal";

const oneRound: RulesConfig = { ...EAST_COAST, rounds: 1 };

interface Choice {
  readonly heuristic: Action | null;
  readonly played: Action | null;
}

/** Play matches at a level, noting for every move what the plain heuristic would have done. */
function watch(level: BotLevel, seeds: readonly number[]): Choice[] {
  const choices: Choice[] = [];
  const policy = levelPolicy(level);
  const spy: Policy = (state, seat) => {
    const played = policy(state, seat);
    choices.push({ heuristic: heuristicPolicy(state, seat), played });
    return played;
  };
  for (const seed of seeds) playMatch([spy, spy, spy], oneRound, seed);
  return choices;
}

const SEEDS = [1, 2, 3, 4, 5, 6];

describe("computer levels", () => {
  it("Hard plays exactly the heuristic", () => {
    const choices = watch("hard", SEEDS);
    expect(choices.some((c) => c.played?.type === "takePile")).toBe(true);
    for (const c of choices) expect(c.played).toEqual(c.heuristic);
  });

  it("Easy never takes the pile, and draws instead whenever the heuristic would", () => {
    const choices = watch("easy", SEEDS);
    const wouldTake = choices.filter((c) => c.heuristic?.type === "takePile");
    expect(wouldTake.length).toBeGreaterThan(0);
    for (const c of choices) expect(c.played?.type).not.toBe("takePile");
    for (const c of wouldTake) expect(c.played).toEqual({ type: "draw" });
    // Every other move is the heuristic's own.
    for (const c of choices.filter((c) => c.heuristic?.type !== "takePile")) {
      expect(c.played).toEqual(c.heuristic);
    }
  });

  it("Standard takes the pile on some of the turns Hard would, and draws on the rest", () => {
    const choices = watch("standard", SEEDS);
    const wouldTake = choices.filter((c) => c.heuristic?.type === "takePile");
    const took = wouldTake.filter((c) => c.played?.type === "takePile");
    const drew = wouldTake.filter((c) => c.played?.type === "draw");
    expect(took.length).toBeGreaterThan(0);
    expect(drew.length).toBeGreaterThan(0);
    expect(took.length + drew.length).toBe(wouldTake.length);
    for (const c of choices.filter((c) => c.heuristic?.type !== "takePile")) {
      expect(c.played).toEqual(c.heuristic);
    }
  });

  it("finishes matches at every level, and the same seed plays the same match", () => {
    for (const level of ["easy", "standard", "hard"] as const) {
      const policies = [levelPolicy(level), levelPolicy(level)];
      const a = playMatch(policies, { ...EAST_COAST, rounds: 2 }, 9);
      expect(a.complete).toBe(true);
      expect(playMatch(policies, { ...EAST_COAST, rounds: 2 }, 9)).toEqual(a);
    }
  });

  it("takes about half the chances at Standard", () => {
    expect(STANDARD_PILE_SHARE).toBe(0.5);
  });
});

describe("pileCoin", () => {
  const state = deal(3, oneRound, 42);

  it("is the same for the same position, in [0, 1)", () => {
    const coin = pileCoin(state);
    expect(pileCoin(state)).toBe(coin);
    expect(coin).toBeGreaterThanOrEqual(0);
    expect(coin).toBeLessThan(1);
  });

  it("changes with each part of the position", () => {
    const coin = pileCoin(state);
    const changed = [
      { ...state, seed: state.seed + 1 },
      { ...state, roundNumber: state.roundNumber + 1 },
      { ...state, currentSeat: (state.currentSeat + 1) % 3 },
      { ...state, stock: state.stock.slice(1) },
      { ...state, discard: [...state.discard, ...state.stock.slice(0, 1)] },
    ];
    for (const other of changed) expect(pileCoin(other)).not.toBe(coin);
  });

  it("comes up below one half about half the time", () => {
    let below = 0;
    for (let seed = 0; seed < 2000; seed++) {
      if (pileCoin({ ...state, seed }) < 0.5) below++;
    }
    expect(below).toBeGreaterThan(900);
    expect(below).toBeLessThan(1100);
  });
});
