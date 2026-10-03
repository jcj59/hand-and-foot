import { describe, it, expect } from "vitest";
import type { Action, GameState } from "@hf/shared";
import { LEARNER, lessonById } from "@hf/scenarios";
import { computerMove, finished, learnerMove, startRun, updateFor } from "./lessonRun";

const pile = lessonById("pile")!;
const threes = lessonById("threes")!;
const card = (state: GameState, rank: string, suit: string) =>
  state.players[LEARNER]!.hand.find((c) => c.rank === rank && c.suit === suit)!;

describe("a lesson being played", () => {
  it("plays a move that does what the step asks, and moves on to the next", () => {
    const run = learnerMove(pile, startRun(pile), { type: "takePile" });
    expect(run.step).toBe(1);
    expect(run.seq).toBe(1);
    expect(run.feedback).toBeNull();
    expect(run.lastMove).toMatchObject({ seq: 1, seat: LEARNER, kind: "takePile" });
  });

  it("does not play a legal move that is not the one asked for, and says why", () => {
    const start = startRun(pile);
    const run = learnerMove(pile, start, { type: "draw" });
    expect(run.state).toBe(start.state);
    expect(run.step).toBe(0);
    expect(run.seq).toBe(0);
    expect(run.feedback).toBe(pile.steps[0]!.hint);
  });

  it("gives the engine's reason for a move it refuses", () => {
    const start = startRun(threes);
    const run = learnerMove(threes, start, { type: "draw" });
    expect(run.feedback).toBe("A card can only be drawn during the draw phase.");
    expect(run.state).toBe(start.state);
  });

  it("is done after the last step, and plays nothing more", () => {
    const start = startRun(threes);
    const red: Action = { type: "discard", cardId: card(start.state, "3", "hearts").id };
    const run = learnerMove(threes, start, red);
    expect(finished(threes, run)).toBe(true);
    expect(learnerMove(threes, run, { type: "draw" })).toBe(run);
  });

  it("lets the computer player move only on its own turn", () => {
    const start = startRun(threes);
    expect(computerMove(start)).toBe(start);
    const run = learnerMove(threes, start, {
      type: "discard",
      cardId: card(start.state, "3", "hearts").id,
    });
    expect(run.state.currentSeat).toBe(1);
    const after = computerMove(run);
    expect(after.seq).toBe(2);
    expect(after.lastMove?.seat).toBe(1);
    expect(after.step).toBe(run.step);
  });

  it("shows the learner the table as their seat would see it", () => {
    const run = startRun(pile);
    const update = updateFor(pile, run);
    expect(update.view.seat).toBe(LEARNER);
    expect(update.view.hand).toEqual(run.state.players[LEARNER]!.hand);
    expect(JSON.stringify(update)).not.toContain(`"${run.state.players[1]!.hand[0]!.id}"`);
    expect(update.room.players.map((p) => [p.name, p.bot ?? false])).toEqual([
      ["You", false],
      ["Robo Rita", true],
    ]);
    expect(update.hints.canTakePile).toBe(true);
  });
});
