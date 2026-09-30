import { describe, it, expect } from "vitest";
import type { RoundEnded } from "@hf/shared";
import { soundsFor, type Moment } from "./sounds";

const quiet: Moment = { moveSeq: 1, moveKind: "draw", myTurn: false, result: null };
const ended = (matchOver: boolean) => ({ matchOver }) as unknown as RoundEnded;

describe("which sounds a change makes", () => {
  it("flicks a card for every new move, and riffles for a pile pickup", () => {
    expect(soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind: "discard" })).toEqual(["card"]);
    expect(soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind: "meld" })).toEqual(["card"]);
    expect(soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind: "takePile" })).toEqual(["pile"]);
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
    ).toEqual(["card", "round"]);
    // A round's end is not also announced as the next player's turn.
    expect(soundsFor(quiet, { ...quiet, myTurn: true, result: ended(false) })).toEqual(["round"]);
  });
});
