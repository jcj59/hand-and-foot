/**
 * The table's sounds, played with the Web Audio API.
 *
 * Each kind of move has one short recording (Kenney's Casino Audio, CC0, in
 * `public/sounds`), played once per move however many cards it moves. The turn's
 * ding (a struck bell's partials) and the round-end phrases (a few sine notes with
 * a soft envelope) are synthesized, and a synthesized flick stands in for a
 * recording not yet loaded.
 *
 * What plays when is decided by `soundsFor`, a pure function over the table as it
 * was and as it is — so the decision is tested without a speaker, and the audio
 * glue (`useTableSounds`) only plays what it is told.
 *
 * Browsers only allow sound after the player has interacted with the page, and
 * suspend it when they please; `audio.ts` keeps the page's one context able to
 * play through all that.
 */
import { useEffect, useRef, useState } from "react";
import type { LastMove, RoundEnded } from "@hf/shared";
import { installAudio, onAudioContext, useAudioBlocked, withAudio } from "./audio";

/** A recorded card sound, one per kind of move; see `public/sounds`. */
export type CardSound = "draw" | "discard" | "meld" | "take-back";
/** `pile` is the draw's recording played lower and slower: a draw, but more of it. */
export type Sound = CardSound | "pile" | "turn" | "round" | "match" | "airhorn" | "reaction";

/** Which recording marks each move. One sound per move, however many cards it moves. */
const CARD_SOUND: Readonly<Record<LastMove["kind"], Sound>> = {
  draw: "draw",
  discard: "discard",
  meld: "meld",
  takePile: "pile",
  takeBack: "take-back",
};

const CARD_SOUNDS: readonly CardSound[] = ["draw", "discard", "meld", "take-back"];

/** What the table looked like at one moment, as far as sound is concerned. */
export interface Moment {
  readonly moveSeq: number | null;
  readonly moveKind: LastMove["kind"] | null;
  readonly myTurn: boolean;
  readonly result: RoundEnded | null;
}

/** One sound to play, and how long after the moment to start it. */
export interface Cue {
  readonly sound: Sound;
  /** Milliseconds after the change is heard. */
  readonly delayMs: number;
}

/**
 * How long the turn's ding waits after a card sound in the same moment: the move
 * that hands you the turn (their discard, usually) and the ding arrive together,
 * and a ding started under a card's rustle is easily lost in it.
 */
export const TURN_AFTER_CARD_MS = 250;

/** The sounds that mark the change from one moment to the next, in order, with when each starts. */
export function soundsFor(before: Moment, now: Moment): Cue[] {
  const cues: Cue[] = [];
  if (now.moveSeq !== null && now.moveSeq !== before.moveSeq && now.moveKind) {
    cues.push({ sound: CARD_SOUND[now.moveKind], delayMs: 0 });
  }
  if (now.result && !before.result)
    cues.push({ sound: now.result.matchOver ? "match" : "round", delayMs: 0 });
  else if (now.myTurn && !before.myTurn) {
    cues.push({ sound: "turn", delayMs: cues.length > 0 ? TURN_AFTER_CARD_MS : 0 });
  }
  return cues;
}

const MUTE_KEY = "hf.muted";

/** Whether this device has the table's sounds off (the Sound toggle, and Profile's Sounds). */
export function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

/** A card: a few milliseconds of noise, band-passed so it sounds papery, not hissy. */
function flick(ctx: AudioContext, at: number, gain: number): void {
  const length = Math.floor(ctx.sampleRate * 0.06);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2_600;
  band.Q.value = 0.8;
  const level = ctx.createGain();
  level.gain.value = gain;
  source.connect(band).connect(level).connect(ctx.destination);
  source.start(at);
}

/**
 * Fetch and decode the card recordings, served beside the page. A recording that
 * cannot be had — offline, or a browser that will not decode it — leaves the
 * synthesized flick in its place.
 */
async function loadRecordings(ctx: AudioContext, into: Map<CardSound, AudioBuffer>): Promise<void> {
  await Promise.all(
    CARD_SOUNDS.map(async (name) => {
      if (into.has(name)) return;
      try {
        const response = await fetch(`/sounds/${name}.wav`);
        if (!response.ok) return;
        into.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
      } catch {
        // Keep the flick.
      }
    }),
  );
}

/** One soft sine note. */
function note(
  ctx: AudioContext,
  frequency: number,
  at: number,
  duration: number,
  gain = 0.18,
): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = frequency;
  const level = ctx.createGain();
  level.gain.setValueAtTime(0, at);
  level.gain.linearRampToValueAtTime(gain, at + 0.02);
  level.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(level).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

/** Play one sound, now or `delay` seconds from now (scheduled on the audio clock, not a timer). */
export function play(
  ctx: AudioContext,
  sound: Sound,
  recordings: ReadonlyMap<CardSound, AudioBuffer>,
  delay = 0,
): void {
  const t = ctx.currentTime + 0.01 + delay;
  switch (sound) {
    case "draw":
    case "discard":
    case "meld":
    case "take-back":
    case "pile": {
      const recording = recordings.get(sound === "pile" ? "draw" : sound);
      // Until the recordings have loaded — a moment after the first tap — a
      // synthesized flick stands in.
      if (!recording) return flick(ctx, t, 0.5);
      const source = ctx.createBufferSource();
      source.buffer = recording;
      // The pile is the draw's sound, a little lower and slower: the same motion,
      // with more cards in it.
      if (sound === "pile") source.playbackRate.value = 0.8;
      const level = ctx.createGain();
      level.gain.value = 0.9;
      source.connect(level).connect(ctx.destination);
      source.start(t);
      return;
    }
    case "turn":
      ding(ctx, t);
      return;
    case "round":
      // A rising major arpeggio.
      [523.25, 659.25, 783.99].forEach((f, i) => note(ctx, f, t + i * 0.12, 0.45));
      return;
    case "match":
      // The arpeggio, and the octave held.
      [523.25, 659.25, 783.99, 1_046.5].forEach((f, i) => note(ctx, f, t + i * 0.14, 0.5));
      note(ctx, 1_046.5, t + 0.56, 1.1, 0.14);
      return;
    case "airhorn":
      airHorn(ctx, t);
      return;
    case "reaction":
      // A soft, quick upward blip: someone said something.
      note(ctx, 880, t, 0.09, 0.08);
      note(ctx, 1_318.5, t + 0.05, 0.12, 0.07);
      return;
  }
}

/**
 * The turn's ding, as a struck bell: partials at a bell's inharmonic ratios to the
 * strike note, the higher ones quieter and quicker to die, each with a few
 * milliseconds' attack and an exponential ring-out. The strike note is doubled a
 * few hertz apart, so it shimmers as a real bell beats.
 */
export const DING_PARTIALS: readonly {
  readonly ratio: number;
  readonly gain: number;
  readonly decay: number;
}[] = [
  { ratio: 1, gain: 0.26, decay: 1.2 },
  { ratio: 1.004, gain: 0.12, decay: 1.2 },
  { ratio: 2.32, gain: 0.1, decay: 0.75 },
  { ratio: 4.25, gain: 0.05, decay: 0.4 },
  { ratio: 6.63, gain: 0.025, decay: 0.22 },
];

/** The ding's strike note: E6, high enough to cut through talk at the table. */
const DING_HZ = 1_318.5;

function ding(ctx: AudioContext, at: number): void {
  for (const { ratio, gain, decay } of DING_PARTIALS) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = DING_HZ * ratio;
    const level = ctx.createGain();
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(gain, at + 0.004);
    level.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(level).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/** The DJ air horn's rhythm: three stabs and a long blast, as [start, length] in seconds. */
const AIR_HORN_BLASTS: readonly (readonly [number, number])[] = [
  [0, 0.11],
  [0.16, 0.11],
  [0.32, 0.11],
  [0.5, 0.95],
];

/**
 * A DJ air horn, synthesized: a stack of slightly detuned sawtooths (the horn's
 * reedy beating), pushed through a soft clipper and a band-pass around the honk,
 * stuttered into the classic three stabs and a long blast. Synthesized rather than
 * recorded so there is no asset to fetch before the first Marva.
 */
function airHorn(ctx: AudioContext, at: number): void {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(3 * x);
  }
  shaper.curve = curve;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1_400;
  band.Q.value = 0.8;
  const level = ctx.createGain();
  level.gain.value = 0;
  shaper.connect(band).connect(level).connect(ctx.destination);

  const end = at + AIR_HORN_BLASTS.reduce((last, [s, d]) => Math.max(last, s + d), 0) + 0.1;
  for (const detune of [-14, -5, 0, 6, 13]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    // A little scoop up into pitch at the start, as a real horn has.
    osc.frequency.setValueAtTime(400, at);
    osc.frequency.linearRampToValueAtTime(466, at + 0.05);
    osc.detune.value = detune;
    const voice = ctx.createGain();
    voice.gain.value = 0.12;
    osc.connect(voice).connect(shaper);
    osc.start(at);
    osc.stop(end);
  }
  for (const [start, length] of AIR_HORN_BLASTS) {
    const on = at + start;
    level.gain.setValueAtTime(0, on);
    level.gain.linearRampToValueAtTime(0.35, on + 0.012);
    level.gain.setValueAtTime(0.35, on + length - 0.03);
    level.gain.linearRampToValueAtTime(0, on + length);
  }
}

/**
 * The card recordings, decoded once for the page. A buffer is not tied to the
 * context that decoded it, so a replacement context plays the same ones.
 */
const recordings = new Map<CardSound, AudioBuffer>();

/**
 * Play the table's sounds as it changes. Returns whether sound is muted and a
 * way to change it; the choice is remembered on this device.
 *
 * A `quiet` change is taken note of but not heard: a replay seeking to a new
 * point has not had anything happen, so it should not sound as if it had.
 */
export function useTableSounds(
  now: Moment,
  quiet = false,
): {
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** Whether the browser is holding sound back until the player taps. */
  blocked: boolean;
  /** Play one sound now, outside the table's own changes — unless muted or not allowed yet. */
  playSound: (sound: Sound) => void;
} {
  const [muted, setMutedState] = useState(readMuted);
  const blocked = useAudioBlocked();
  const before = useRef<Moment | null>(null);

  useEffect(() => {
    installAudio();
    return onAudioContext((ctx) => void loadRecordings(ctx, recordings));
  }, []);

  useEffect(() => {
    const previous = before.current;
    before.current = now;
    // The first moment is where the page came in, not a change to announce.
    if (!previous || muted || quiet) return;
    const sounds = soundsFor(previous, now);
    if (sounds.length === 0) return;
    withAudio((ctx) => {
      for (const { sound, delayMs } of sounds) play(ctx, sound, recordings, delayMs / 1000);
    });
  }, [now, muted, quiet]);

  return {
    muted,
    setMuted: (next) => {
      setMutedState(next);
      writeMuted(next);
    },
    blocked,
    playSound: (sound) => {
      if (!muted) withAudio((ctx) => play(ctx, sound, recordings));
    },
  };
}
