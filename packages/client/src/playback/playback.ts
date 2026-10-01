/**
 * Where a replay is and what it is doing, as a pure reducer, so seeking, stepping,
 * speed and the end of a range can be asserted without rendering or timers.
 */
import type { Timeline } from "@hf/engine";

/** Times normal speed, or "instant": as fast as it can go, with nothing animated. */
export type Speed = 0.5 | 1 | 2 | 4 | 8 | "instant";
export const SPEEDS: readonly Speed[] = [0.5, 1, 2, 4, 8, "instant"];

export interface PlaybackState {
  readonly step: number;
  readonly playing: boolean;
  readonly speed: Speed;
  /**
   * How the current step was reached: a number when it was played forward, null
   * when it was jumped to. See `frameAt`.
   */
  readonly playedAs: number | null;
  /** Counts steps played forward, to number each one afresh. */
  readonly ticks: number;
  /** The part of the timeline played through: all of it, or a window around a moment. */
  readonly from: number;
  readonly to: number;
  /** The whole timeline, which stepping and seeking may still range over. */
  readonly length: number;
}

export type PlaybackEvent =
  | { readonly type: "play" }
  | { readonly type: "pause" }
  | { readonly type: "toggle" }
  /** One step forward, as played: animated, unless the speed is instant. */
  | { readonly type: "forward" }
  | { readonly type: "back" }
  | { readonly type: "seek"; readonly step: number }
  | { readonly type: "speed"; readonly speed: Speed };

export function initialPlayback(
  length: number,
  options: { step?: number; from?: number; to?: number; playing?: boolean; speed?: Speed } = {},
): PlaybackState {
  const from = clamp(options.from ?? 0, 0, length);
  const to = clamp(options.to ?? length, from, length);
  return {
    step: clamp(options.step ?? from, 0, length),
    playing: options.playing ?? false,
    speed: options.speed ?? 1,
    playedAs: null,
    ticks: 0,
    from,
    to,
    length,
  };
}

export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  switch (event.type) {
    case "play":
      // Playing from the end starts the range again, as any player does.
      return state.step >= state.to
        ? { ...state, playing: true, step: state.from, playedAs: null }
        : { ...state, playing: true };
    case "pause":
      return { ...state, playing: false };
    case "toggle":
      return playbackReducer(state, { type: state.playing ? "pause" : "play" });
    case "forward": {
      if (state.step >= state.length) return { ...state, playing: false };
      const ticks = state.ticks + 1;
      const step = state.step + 1;
      return {
        ...state,
        step,
        ticks,
        playedAs: state.speed === "instant" ? null : ticks,
        playing: state.playing && step < state.to,
      };
    }
    case "back":
      return state.step <= 0
        ? state
        : { ...state, step: state.step - 1, playedAs: null, playing: false };
    case "seek":
      return { ...state, step: clamp(Math.round(event.step), 0, state.length), playedAs: null };
    case "speed":
      return { ...state, speed: event.speed };
  }
}

/** Normal-speed pause before playing the action that leads to each step, by kind. */
const ACTION_MS = {
  draw: 900,
  takePile: 1400,
  playMelds: 1500,
  discard: 1100,
  takeBack: 1300,
  nextRound: 1800,
} as const;
/** Extra time to read the scores at the end of a round, and to take in a named moment. */
export const ROUND_END_DWELL_MS = 3_500;
export const MOMENT_DWELL_MS = 1_500;
export const INSTANT_MS = 30;

/** How long to wait at `step` before playing the next one. */
export function delayAt(timeline: Timeline, step: number, speed: Speed): number {
  if (speed === "instant") return INSTANT_MS;
  let ms = ACTION_MS[timeline.entry(step + 1).action.type];
  if (timeline.stateAt(step).roundEnded) ms += ROUND_END_DWELL_MS;
  if (timeline.moments.some((m) => m.kind === "named" && m.step === step)) ms += MOMENT_DWELL_MS;
  return ms / speed;
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(Math.max(n, low), high);
}
