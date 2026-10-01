import { describe, it, expect } from "vitest";
import { EAST_COAST } from "@hf/shared";
import { deal } from "@hf/engine";
import { arrange } from "./arrange";
import {
  AUTO_ACTION_LIMIT,
  autoTurns,
  autoUntil,
  discard,
  draw,
  meld,
  moment,
  nextRound,
  resolveScript,
  takeBack,
  takePile,
} from "./script";
import { buildScenario, type Scenario } from "./scenario";

const table = () =>
  arrange(
    {
      seed: 4,
      seats: [{ hand: "KC KD KH 9S 4D", melds: { Q: "QC QD QH" } }, {}],
      stockTop: "KS 7C",
    },
    EAST_COAST,
  );

describe("resolving a script", () => {
  it("turns named cards into the ids of the cards in the active zone", () => {
    const start = table();
    const { actions, moments, final } = resolveScript(start, [
      draw(),
      meld({ K: "KC KD KH KS" }),
      moment("melded", "Kings"),
      takeBack(),
      meld({ K: "KC KD KH" }),
      discard("9S"),
    ]);
    const kings = start.players[0]!.hand.filter((c) => c.rank === "K").map((c) => c.id);
    expect(actions[1]).toEqual({
      type: "playMelds",
      melds: [{ rank: "K", cardIds: [...kings, start.stock[0]!.id] }],
    });
    expect(actions.map((a) => a.type)).toEqual([
      "draw",
      "playMelds",
      "takeBack",
      "playMelds",
      "discard",
    ]);
    expect(moments).toEqual([{ id: "melded", label: "Kings", step: 2 }]);
    expect(final.currentSeat).toBe(1);
  });

  it("discards by the default heuristic when no card is named", () => {
    const { actions, final } = resolveScript(table(), [draw(), discard()]);
    expect(actions[1]!.type).toBe("discard");
    expect(final.currentSeat).toBe(1);
  });

  it("names the step and the reason when a step cannot be played", () => {
    expect(() => resolveScript(table(), [draw(), draw()])).toThrow(
      /^step 2 \(draw\) was refused: /,
    );
    expect(() => resolveScript(table(), [draw(), discard("AS")])).toThrow(
      "no AS in seat 0's cards",
    );
    expect(() => resolveScript(table(), [draw(), meld({ K: "KC KC KC KC KC" })])).toThrow(
      "no KC in seat 0's cards",
    );
    expect(() => resolveScript(table(), [takePile()])).toThrow(/takePile\) was refused/);
  });

  it("refuses a discard from a player with nothing to throw", () => {
    const empty = arrange(
      { seed: 1, seats: [{ inFoot: true, foot: "", melds: { K: "KC KD KH" } }, {}], phase: "play" },
      EAST_COAST,
    );
    expect(() => resolveScript(empty, [discard()])).toThrow("seat 0 has nothing to discard");
  });

  it("plays whole turns on autopilot, and stops at the end of the round", () => {
    const start = deal(3, EAST_COAST, 9);
    const { actions, final } = resolveScript(start, [autoTurns(4)]);
    // Four turns: back to the second player, in the draw phase.
    expect(final.currentSeat).toBe(1);
    expect(final.phase).toBe("draw");
    expect(actions.length).toBeGreaterThanOrEqual(8);
    const round = resolveScript(start, [autoUntil("round")]);
    expect(round.final.roundEnded).toBe(true);
    const more = resolveScript(round.final, [autoTurns(3)]);
    expect(more.actions).toEqual([]);
  });

  it("plays a whole match, dealing every round, or deals one when told to", () => {
    const { final, actions } = resolveScript(deal(2, EAST_COAST, 2), [autoUntil("match")]);
    expect(final.roundNumber).toBe(4);
    expect(final.roundEnded).toBe(true);
    expect(actions.filter((a) => a.type === "nextRound")).toHaveLength(3);
    const { final: next } = resolveScript(
      resolveScript(deal(2, EAST_COAST, 2), [autoUntil("round")]).final,
      [nextRound()],
    );
    expect(next.roundNumber).toBe(2);
  });

  it("gives up on an autopilot game that never ends", () => {
    // Pinned as a literal: far beyond any real round.
    expect(AUTO_ACTION_LIMIT).toBe(5000);
    // Two players with these seeds circle forever once the shoe is melded out.
    expect(() => resolveScript(deal(2, EAST_COAST, 4), [autoUntil("match")])).toThrow(
      /more than 5000 actions/,
    );
  });
});

describe("building a scenario", () => {
  const base: Scenario = {
    id: "test",
    title: "Test",
    description: "A scenario for testing the builder.",
    config: EAST_COAST,
    setup: { seed: 4, seats: [{}, {}] },
    names: ["Ana", "Ben"],
    script: [draw(), discard()],
  };

  it("hands the player a hand-built start as a state, and a deal as its seed", () => {
    const built = buildScenario(base);
    expect("state" in built.setup).toBe(true);
    expect(built.names).toEqual(["Ana", "Ben"]);
    expect(built.actions).toHaveLength(2);
    const seeded = buildScenario({ ...base, setup: { seed: 4, playerCount: 2 } });
    expect(seeded.setup).toEqual({ seed: 4, playerCount: 2 });
  });

  it("says which scenario failed, and why", () => {
    expect(() => buildScenario({ ...base, names: ["Ana"] })).toThrow("test: 1 names for 2 seats");
    expect(() => buildScenario({ ...base, script: [discard()] })).toThrow(/^test: step 1/);
  });
});
