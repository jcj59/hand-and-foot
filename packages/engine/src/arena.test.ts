import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import {
  ROUND_ACTION_LIMIT,
  type MatchResult,
  type Policy,
  defaultPolicy,
  heuristicPolicy,
  playMatch,
  winners,
} from "./arena";
import { heuristicAction } from "./policy";
import { project } from "./view";

const twoRounds: RulesConfig = { ...EAST_COAST, rounds: 2 };

describe("playMatch", () => {
  it("plays every round of a match between heuristic seats to its end", () => {
    const result = playMatch([heuristicPolicy, heuristicPolicy], twoRounds, 3);
    expect(result.complete).toBe(true);
    expect(result.roundsEnded).toBe(2);
    expect(result.wentOut).toHaveLength(2);
    expect(result.totals).toHaveLength(2);
    expect(result.actions).toBeGreaterThan(0);
  });

  it("is deterministic: the same seed plays the same match", () => {
    const a = playMatch([heuristicPolicy, heuristicPolicy, heuristicPolicy], twoRounds, 11);
    const b = playMatch([heuristicPolicy, heuristicPolicy, heuristicPolicy], twoRounds, 11);
    expect(a).toEqual(b);
  });

  it("gives the heuristic seat only that seat's view", () => {
    const seen: number[] = [];
    const spy: Policy = (state, seat) => {
      seen.push(seat);
      return heuristicAction(project(state, seat), state.config);
    };
    playMatch([spy, heuristicPolicy], { ...EAST_COAST, rounds: 1 }, 5);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([0]));
  });

  it("calls a round stalled when it outlasts the action limit: a table of defaults", () => {
    const result = playMatch([defaultPolicy, defaultPolicy], twoRounds, 1, 200);
    expect(result).toMatchObject({ complete: false, roundsEnded: 0, actions: 200 });
    expect(result.totals).toEqual([0, 0]);
  });

  it("counts the rounds that did end before one stalled", () => {
    // One heuristic seat ends round one; the limit is then too small for round two.
    const first = playMatch([heuristicPolicy, heuristicPolicy], { ...twoRounds, rounds: 1 }, 3);
    const limit = first.actions;
    const result = playMatch([heuristicPolicy, heuristicPolicy], twoRounds, 3, limit);
    expect(result.complete).toBe(false);
    expect(result.roundsEnded).toBe(1);
    expect(result.totals).toEqual(first.totals);
  });

  it("counts the limit per round, not across the match", () => {
    const first = playMatch([heuristicPolicy, heuristicPolicy], { ...twoRounds, rounds: 1 }, 3);
    const both = playMatch([heuristicPolicy, heuristicPolicy], twoRounds, 3);
    const longest = Math.max(first.actions, both.actions - first.actions);
    const result = playMatch([heuristicPolicy, heuristicPolicy], twoRounds, 3, longest);
    expect(result).toEqual(both);
  });

  it("allows five thousand actions a round by default", () => {
    expect(ROUND_ACTION_LIMIT).toBe(5_000);
  });

  it("throws, naming the seed and seat, when a policy proposes a refused move", () => {
    const discardsInDrawPhase: Policy = () => ({ type: "discard", cardId: "nope" });
    expect(() => playMatch([discardsInDrawPhase, heuristicPolicy], twoRounds, 42)).toThrow(
      /seed 42: seat 0 proposed .*discard.*refused: a card can only be discarded/,
    );
  });

  it("throws when a policy proposes nothing on its own turn", () => {
    expect(() => playMatch([() => null, heuristicPolicy], twoRounds, 7)).toThrow(
      "seed 7: seat 0 proposed no move on its own turn",
    );
  });
});

describe("winners", () => {
  const result = (totals: number[]): MatchResult => ({
    totals,
    roundsEnded: 1,
    wentOut: [0],
    complete: true,
    actions: 1,
  });

  it("names the seat with the highest total", () => {
    expect(winners(result([120, 450, -30]))).toEqual([1]);
  });

  it("names every seat sharing the highest total", () => {
    expect(winners(result([300, -10, 300]))).toEqual([0, 2]);
  });
});
