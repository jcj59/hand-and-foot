import { describe, it, expect } from "vitest";
import type { RoundEnded } from "@hf/shared";
import { soundsFor, type Moment } from "./sounds";

const quiet: Moment = { moveSeq: 1, moveKind: "draw", myTurn: false, result: null };
const ended = (matchOver: boolean) => ({ matchOver }) as unknown as RoundEnded;

describe("which sounds a change makes", () => {
  it("plays one recorded sound for each move, however many cards it moves", () => {
    const kinds = ["draw", "discard", "meld", "takePile", "takeBack"] as const;
    expect(kinds.map((moveKind) => soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind }))).toEqual([
      ["draw"],
      ["discard"],
      ["meld"],
      ["pile"],
      ["take-back"],
    ]);
  });

  it("says nothing when nothing has moved", () => {
    expect(soundsFor(quiet, { ...quiet })).toEqual([]);
    expect(soundsFor(quiet, { ...quiet, moveSeq: null, moveKind: null })).toEqual([]);
  });

  it("chimes when the turn comes to this player, and only then", () => {
    expect(soundsFor(quiet, { ...quiet, myTurn: true })).toEqual(["turn"]);
    expect(soundsFor({ ...quiet, myTurn: true }, { ...quiet, myTurn: true })).toEqual([]);
    expect(soundsFor({ ...quiet, myTurn: true }, quiet)).toEqual([]);
  });

  it("marks the end of a round, and the end of the match differently", () => {
    expect(soundsFor(quiet, { ...quiet, result: ended(false) })).toEqual(["round"]);
    expect(soundsFor(quiet, { ...quiet, result: ended(true) })).toEqual(["match"]);
    // The last card and the result arrive together: both are heard, card first.
    expect(
      soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind: "discard", result: ended(false) }),
    ).toEqual(["discard", "round"]);
    // A round's end is not also announced as the next player's turn.
    expect(soundsFor(quiet, { ...quiet, myTurn: true, result: ended(false) })).toEqual(["round"]);
  });
});
