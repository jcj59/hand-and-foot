import { describe, it, expect } from "vitest";
import { EAST_COAST } from "@hf/shared";
import { buildTimeline } from "@hf/engine";
import { recordRich } from "@hf/engine/testing";
import {
  INSTANT_MS,
  MOMENT_DWELL_MS,
  ROUND_END_DWELL_MS,
  SPEEDS,
  delayAt,
  initialPlayback,
  playbackReducer,
  type PlaybackEvent,
  type PlaybackState,
} from "./playback";

const run = (state: PlaybackState, ...events: PlaybackEvent[]): PlaybackState =>
  events.reduce(playbackReducer, state);

describe("the playback reducer", () => {
  it("starts at the start of its range, paused, at normal speed, unless told otherwise", () => {
    expect(initialPlayback(10)).toEqual({
      step: 0,
      playing: false,
      speed: 1,
      playedAs: null,
      ticks: 0,
      from: 0,
      to: 10,
      length: 10,
    });
    const windowed = initialPlayback(10, { from: 3, to: 6, playing: true, speed: 4 });
    expect(windowed).toMatchObject({ step: 3, from: 3, to: 6, playing: true, speed: 4 });
    // Out-of-range options are pulled back into the timeline.
    expect(initialPlayback(10, { step: 50, from: -2, to: 99 })).toMatchObject({
      step: 10,
      from: 0,
      to: 10,
    });
    expect(initialPlayback(10, { from: 8, to: 2 })).toMatchObject({ from: 8, to: 8 });
  });

  it("numbers each step played forward afresh, so the table sees every one as new", () => {
    const s = run(initialPlayback(10), { type: "forward" }, { type: "forward" });
    expect(s).toMatchObject({ step: 2, playedAs: 2, ticks: 2 });
    // Back and forward again: the same step, a new number.
    const again = run(s, { type: "back" }, { type: "forward" });
    expect(again).toMatchObject({ step: 2, playedAs: 3 });
  });

  it("lands silently after stepping back or seeking", () => {
    const s = run(initialPlayback(10), { type: "forward" }, { type: "forward" });
    expect(run(s, { type: "back" })).toMatchObject({ step: 1, playedAs: null });
    expect(run(s, { type: "seek", step: 7 })).toMatchObject({ step: 7, playedAs: null });
    expect(run(s, { type: "seek", step: 99 }).step).toBe(10);
    expect(run(s, { type: "seek", step: -3 }).step).toBe(0);
    expect(run(s, { type: "seek", step: 4.6 }).step).toBe(5);
    // Nothing before the start.
    const start = initialPlayback(10);
    expect(run(start, { type: "back" })).toBe(start);
  });

  it("stops at the end of its range when playing, and may still be stepped past it by hand", () => {
    const s = run(initialPlayback(10, { from: 2, to: 4, playing: true }), { type: "forward" });
    expect(s).toMatchObject({ step: 3, playing: true });
    const ended = run(s, { type: "forward" });
    expect(ended).toMatchObject({ step: 4, playing: false });
    expect(run(ended, { type: "forward" })).toMatchObject({ step: 5, playing: false });
    const atEnd = run(initialPlayback(2, { step: 2 }), { type: "forward" });
    expect(atEnd).toMatchObject({ step: 2, playing: false });
  });

  it("plays from the start of the range again when asked to play at its end", () => {
    const s = run(initialPlayback(10, { from: 2, to: 4, step: 4 }), { type: "play" });
    expect(s).toMatchObject({ step: 2, playing: true, playedAs: null });
    const mid = run(initialPlayback(10, { step: 5 }), { type: "toggle" });
    expect(mid).toMatchObject({ step: 5, playing: true });
    expect(run(mid, { type: "toggle" }).playing).toBe(false);
    expect(run(mid, { type: "pause" }).playing).toBe(false);
  });

  it("plays instantly with nothing animated", () => {
    const s = run(initialPlayback(10), { type: "speed", speed: "instant" }, { type: "forward" });
    expect(s).toMatchObject({ step: 1, playedAs: null, speed: "instant" });
    expect(SPEEDS).toEqual([0.5, 1, 2, 4, 8, "instant"]);
  });
});

describe("the pause before each move", () => {
  const { actions } = recordRich(36, 4, 40);
  const timeline = buildTimeline({
    config: EAST_COAST,
    setup: { seed: 36, playerCount: 4 },
    actions,
    moments: [{ id: "here", label: "Here", step: 3 }],
  });

  it("depends on the move, divides by the speed, and lingers on a moment", () => {
    // Pinned as literals: how the replay feels at normal speed is a decision.
    expect(ROUND_END_DWELL_MS).toBe(3500);
    expect(MOMENT_DWELL_MS).toBe(1500);
    expect(INSTANT_MS).toBe(30);
    const draw = actions.findIndex((a, i) => a.type === "draw" && i !== 2);
    expect(delayAt(timeline, draw, 1)).toBe(900);
    expect(delayAt(timeline, draw, 2)).toBe(450);
    expect(delayAt(timeline, draw, 0.5)).toBe(1800);
    expect(delayAt(timeline, draw, "instant")).toBe(30);
    const discard = actions.findIndex((a, i) => a.type === "discard" && i !== 3);
    expect(delayAt(timeline, discard, 1)).toBe(1100);
    // Step 3 is marked: the move after it waits a little longer.
    expect(delayAt(timeline, 3, 1)).toBeGreaterThanOrEqual(MOMENT_DWELL_MS + 900);
  });

  it("leaves time to read the scores when a round has ended", () => {
    const ended = buildTimeline({
      config: { ...EAST_COAST, stockExhaustion: "end" },
      setup: {
        state: { ...timeline.stateAt(0), stock: [], discard: [], config: EAST_COAST },
      },
      actions: [{ type: "draw" }, { type: "nextRound" }],
    });
    expect(ended.stateAt(1).roundEnded).toBe(true);
    expect(delayAt(ended, 1, 1)).toBe(1800 + ROUND_END_DWELL_MS);
  });
});
