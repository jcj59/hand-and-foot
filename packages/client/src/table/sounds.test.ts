import { describe, it, expect } from "vitest";
import type { RoundEnded } from "@hf/shared";
import { play, soundsFor, type CardSound, type Moment } from "./sounds";

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

describe("playing a recorded card sound", () => {
  // A stand-in AudioContext that records which buffer each source played, and how fast.
  function fakeContext() {
    const played: { buffer: unknown; rate: number }[] = [];
    const node = () => ({ connect: (next: unknown) => next });
    const ctx = {
      currentTime: 0,
      destination: {},
      createGain: () => ({ ...node(), gain: { value: 1 } }),
      createBufferSource: () => {
        const source = {
          ...node(),
          buffer: null as unknown,
          playbackRate: { value: 1 },
          start: () => played.push({ buffer: source.buffer, rate: source.playbackRate.value }),
        };
        return source;
      },
    };
    return { ctx: ctx as unknown as AudioContext, played };
  }
  const draw = { name: "draw" } as unknown as AudioBuffer;
  const discard = { name: "discard" } as unknown as AudioBuffer;
  const recordings = new Map<CardSound, AudioBuffer>([
    ["draw", draw],
    ["discard", discard],
  ]);

  it("plays a draw at its own speed", () => {
    const { ctx, played } = fakeContext();
    play(ctx, "draw", recordings);
    expect(played).toEqual([{ buffer: draw, rate: 1 }]);
  });

  it("takes the pile to the draw's recording, lower and slower", () => {
    const { ctx, played } = fakeContext();
    play(ctx, "pile", recordings);
    expect(played).toEqual([{ buffer: draw, rate: 0.8 }]);
  });

  it("leaves the other recordings at their own speed", () => {
    const { ctx, played } = fakeContext();
    play(ctx, "discard", recordings);
    expect(played).toEqual([{ buffer: discard, rate: 1 }]);
  });
});
