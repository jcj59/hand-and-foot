import { describe, it, expect } from "vitest";
import type { Action, GameState, Rank } from "@hf/shared";
import { applyAction, heuristicPolicy } from "@hf/engine";
import { parseCards, takeCards } from "./cards";
import { LEARNER, LESSONS, lessonById, lessonStart, type Lesson } from "./tutorial";

/** The learner's cards named in shorthand, from the zone they play from. */
function ids(state: GameState, text: string): string[] {
  const p = state.players[LEARNER]!;
  return takeCards(p.inFoot ? p.foot : p.hand, parseCards(text), "the learner's cards").taken.map(
    (c) => c.id,
  );
}
const meld =
  (groups: Partial<Record<Rank, string>>) =>
  (state: GameState): Action => ({
    type: "playMelds",
    melds: Object.entries(groups).map(([rank, text]) => ({
      rank: rank as Rank,
      cardIds: ids(state, text!),
    })),
  });
const discard =
  (text: string) =>
  (state: GameState): Action => ({
    type: "discard",
    cardId: ids(state, text)[0]!,
  });
const anyDiscard = (state: GameState): Action => {
  const p = state.players[LEARNER]!;
  return { type: "discard", cardId: (p.inFoot ? p.foot : p.hand)[0]!.id };
};

/** A move that does what each step asks, by lesson. */
const SOLUTIONS: Record<string, ((state: GameState) => Action)[]> = {
  turn: [() => ({ type: "draw" }), anyDiscard],
  "getting-down": [meld({ K: "KC KD KH", A: "AS AH AD" }), discard("4C")],
  melds: [meld({ K: "KS", "7": "7C 7D 7H" }), discard("4S")],
  pile: [() => ({ type: "takePile" }), meld({ Q: "QC QD QH" }), discard("4S")],
  wilds: [meld({ "7": "7C 7D 2H" }), discard("4S")],
  threes: [discard("3H")],
  foot: [meld({ "8": "8C 8D 8H" }), anyDiscard],
  "going-out": [meld({ "5": "5C 5D 5H" }), discard("9S")],
};

/** Play a lesson through by its solution, the computer player taking its turns between. */
function playThrough(lesson: Lesson): GameState {
  let state = lessonStart(lesson);
  lesson.steps.forEach((step, i) => {
    expect(state.currentSeat).toBe(LEARNER);
    const action = SOLUTIONS[lesson.id]![i]!(state);
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(`${lesson.id} step ${i + 1}: ${r.error}`);
    expect(step.done(state, action, r.state)).toBe(true);
    state = r.state;
    for (let guard = 0; state.currentSeat !== LEARNER && !state.roundEnded; guard++) {
      expect(guard).toBeLessThan(40);
      const move = heuristicPolicy(state, state.currentSeat)!;
      const o = applyAction(state, move);
      if (!o.ok) throw new Error(o.error);
      state = o.state;
    }
  });
  return state;
}

describe("the tutorial", () => {
  it("has a lesson for each idea, in order", () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      "turn",
      "getting-down",
      "melds",
      "pile",
      "wilds",
      "threes",
      "foot",
      "going-out",
    ]);
    expect(lessonById("pile")?.title).toBe("Taking the pile");
    expect(lessonById("nope")).toBeUndefined();
  });

  for (const lesson of LESSONS) {
    it(`can be played through: ${lesson.title}`, () => {
      const end = playThrough(lesson);
      if (lesson.id === "going-out") expect(end.wentOutSeat).toBe(LEARNER);
    });
  }

  it("starts every lesson on the learner's turn", () => {
    for (const lesson of LESSONS) expect(lessonStart(lesson).currentSeat).toBe(LEARNER);
  });
});

describe("a move that is not the one asked for", () => {
  const tryMove = (id: string, action: (s: GameState) => Action) => {
    const lesson = lessonById(id)!;
    const start = lessonStart(lesson);
    const move = action(start);
    const r = applyAction(start, move);
    return r.ok ? lesson.steps[0]!.done(start, move, r.state) : false;
  };

  it("does not count", () => {
    // Melding only the kings is a legal move in no lesson but does not get down.
    expect(tryMove("getting-down", meld({ K: "KC KD KH" }))).toBe(false);
    expect(tryMove("pile", () => ({ type: "draw" }))).toBe(false);
    expect(tryMove("threes", discard("4S"))).toBe(false);
    expect(tryMove("melds", meld({ K: "KS" }))).toBe(false);
    expect(tryMove("wilds", discard("7C"))).toBe(false);
    expect(tryMove("turn", () => ({ type: "takePile" }))).toBe(false);
  });
});
