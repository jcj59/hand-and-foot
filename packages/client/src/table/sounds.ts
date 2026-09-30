/**
 * The table's sounds, synthesized with the Web Audio API.
 *
 * Nothing is loaded: a card's flick is a short burst of filtered noise, and the
 * turn chime and round-end phrases are a few sine notes with a soft envelope. That
 * keeps the build free of audio files and licences, and every sound is a few lines
 * that can be tuned by ear.
 *
 * What plays when is decided by `soundsFor`, a pure function over the table as it
 * was and as it is — so the decision is tested without a speaker, and the audio
 * glue (`useTableSounds`) only plays what it is told.
 *
 * Browsers only allow sound after the player has interacted with the page, so the
 * audio context is created on the first tap or key press rather than at load.
 */
import { useEffect, useRef, useState } from "react";
import type { LastMove, RoundEnded } from "@hf/shared";

export type Sound = "card" | "pile" | "turn" | "round" | "match";

/** What the table looked like at one moment, as far as sound is concerned. */
export interface Moment {
  readonly moveSeq: number | null;
  readonly moveKind: LastMove["kind"] | null;
  readonly myTurn: boolean;
  readonly result: RoundEnded | null;
}

/** The sounds that mark the change from one moment to the next, in order. */
export function soundsFor(before: Moment, now: Moment): Sound[] {
  const sounds: Sound[] = [];
  if (now.moveSeq !== null && now.moveSeq !== before.moveSeq && now.moveKind) {
    // A pile pickup is a bigger sound than one card: it is a bigger event.
    sounds.push(now.moveKind === "takePile" ? "pile" : "card");
  }
  if (now.result && !before.result) sounds.push(now.result.matchOver ? "match" : "round");
  else if (now.myTurn && !before.myTurn) sounds.push("turn");
  return sounds;
}

const MUTE_KEY = "hf.muted";

const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
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

/** Play one sound now. */
export function play(ctx: AudioContext, sound: Sound): void {
  const t = ctx.currentTime + 0.01;
  switch (sound) {
    case "card":
      flick(ctx, t, 0.5);
      return;
    case "pile":
      // A riffle: several cards in quick succession.
      for (let i = 0; i < 5; i++) flick(ctx, t + i * 0.035, 0.35);
      return;
    case "turn":
      // Up a fourth, bright and short: your move.
      note(ctx, 659.25, t, 0.25);
      note(ctx, 880, t + 0.12, 0.35);
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
  }
}

/**
 * Play the table's sounds as it changes. Returns whether sound is muted and a
 * way to change it; the choice is remembered on this device.
 */
export function useTableSounds(now: Moment): {
  muted: boolean;
  setMuted: (muted: boolean) => void;
} {
  const [muted, setMutedState] = useState(readMuted);
  const ctx = useRef<AudioContext | null>(null);
  const before = useRef<Moment | null>(null);

  // Audio may only start after the player has done something on the page. A touch
  // counts as a gesture only when it ends, so the unlock listens to both ends of a
  // press; iOS also wants a sound started inside that gesture, hence the silence.
  useEffect(() => {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    const unlock = (): void => {
      if (!ctx.current) {
        const created = new Ctor();
        ctx.current = created;
        const silence = created.createBufferSource();
        silence.buffer = created.createBuffer(1, 1, created.sampleRate);
        silence.connect(created.destination);
        silence.start(0);
      }
      if (ctx.current.state !== "running") ctx.current.resume().catch(() => {});
    };
    for (const event of UNLOCK_EVENTS) window.addEventListener(event, unlock);
    return () => {
      for (const event of UNLOCK_EVENTS) window.removeEventListener(event, unlock);
      ctx.current?.close().catch(() => {});
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const previous = before.current;
    before.current = now;
    // The first moment is where the page came in, not a change to announce.
    if (!previous || muted || !ctx.current) return;
    for (const sound of soundsFor(previous, now)) play(ctx.current, sound);
  }, [now, muted]);

  return {
    muted,
    setMuted: (next) => {
      setMutedState(next);
      writeMuted(next);
    },
  };
}
