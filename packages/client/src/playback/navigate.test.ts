import { describe, it, expect } from "vitest";
import { SCENARIOS, buildScenario } from "@hf/scenarios";
import { EAST_COAST } from "@hf/shared";
import { buildTimeline } from "@hf/engine";
import {
  describeStep,
  momentById,
  nextMoment,
  nextTurnStart,
  previousMoment,
  previousTurnStart,
  turnAt,
  turnEnd,
} from "./navigate";

const scenario = (id: string) => buildTimeline(buildScenario(SCENARIOS.find((s) => s.id === id)!));

describe("jumping around a timeline", () => {
  const t = scenario("ordinary-turns");

  it("finds the turn on at a step, and the one just finished at the very end", () => {
    expect(turnAt(t, 0)).toEqual(t.turns[0]);
    const second = t.turns[1]!;
    expect(turnAt(t, second.start)).toEqual(second);
    expect(turnAt(t, second.end - 1)).toEqual(second);
    expect(turnAt(t, t.length)).toEqual(t.turns.at(-1));
    const empty = buildTimeline({
      config: EAST_COAST,
      setup: { seed: 1, playerCount: 2 },
      actions: [],
    });
    expect(turnAt(empty, 0)).toBeNull();
  });

  it("steps between the starts and ends of turns", () => {
    const [first, second, third] = t.turns;
    expect(previousTurnStart(t, 0)).toBeNull();
    // Mid-turn, back goes to this turn's start; at its start, to the one before.
    expect(previousTurnStart(t, second!.start + 1)).toBe(second!.start);
    expect(previousTurnStart(t, second!.start)).toBe(first!.start);
    expect(nextTurnStart(t, first!.start)).toBe(second!.start);
    expect(nextTurnStart(t, second!.start)).toBe(third!.start);
    expect(nextTurnStart(t, t.length)).toBeNull();
    expect(turnEnd(t, first!.start)).toBe(first!.end);
    expect(turnEnd(t, t.length)).toBeNull();
  });

  it("steps between moments, and finds one by the id a link names", () => {
    // Moments at one step are passed together: next goes to the next step that has any.
    const a = t.moments[0]!;
    const b = t.moments.find((m) => m.step > a.step)!;
    const lastAtA = t.moments.filter((m) => m.step === a.step).at(-1);
    expect(previousMoment(t, 0)).toBeNull();
    expect(nextMoment(t, 0)).toEqual(a);
    expect(nextMoment(t, a.step)).toEqual(b);
    expect(previousMoment(t, b.step)).toEqual(lastAtA);
    expect(nextMoment(t, t.length)).toBeNull();
    expect(momentById(t, "getdown")?.kind).toBe("named");
    expect(momentById(t, a.id)).toEqual(a);
    expect(momentById(t, "nope")).toBeNull();
  });

  it("says what happened at each step", () => {
    expect(describeStep(t, 0)).toBe("The start");
    const said = Array.from({ length: t.length }, (_, i) => describeStep(t, i + 1));
    expect(said[0]).toBe("Ana drew");
    expect(said[1]).toBe("Ana melded");
    expect(said[2]).toBe("Ana discarded");
    expect(describeStep(scenario("pile-natural-pair"), 1)).toBe("Ana took the pile");
    const wild = scenario("wild-take-back");
    expect(describeStep(wild, 3)).toBe("Ana took back their melds");
    const match = scenario("match");
    const dealt = match.rounds[1]!.start;
    expect(describeStep(match, dealt)).toBe("Round 2 dealt");
  });
});
