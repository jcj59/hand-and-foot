import { describe, it, expect } from "vitest";
import type { RoundEnded } from "@hf/shared";
import {
  DING_PARTIALS,
  EMOTE_SOUNDS_AT_ONCE,
  EMOTE_SOUND_MS,
  reactionSound,
  TURN_AFTER_CARD_MS,
  play,
  soundsFor,
  type Recorded,
  type Cue,
  type Moment,
} from "./sounds";

const quiet: Moment = { moveSeq: 1, moveKind: "draw", myTurn: false, result: null };
const ended = (matchOver: boolean) => ({ matchOver }) as unknown as RoundEnded;
/** The sounds alone, in order. */
const names = (cues: Cue[]) => cues.map((c) => c.sound);

describe("which sounds a change makes", () => {
  it("plays one recorded sound for each move, however many cards it moves", () => {
    const kinds = ["draw", "discard", "meld", "takePile", "takeBack"] as const;
    expect(
      kinds.map((moveKind) => names(soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind }))),
    ).toEqual([["draw"], ["discard"], ["meld"], ["pile"], ["take-back"]]);
  });

  it("says nothing when nothing has moved", () => {
    expect(soundsFor(quiet, { ...quiet })).toEqual([]);
    expect(soundsFor(quiet, { ...quiet, moveSeq: null, moveKind: null })).toEqual([]);
  });

  it("dings when the turn comes to this player, and only then", () => {
    expect(soundsFor(quiet, { ...quiet, myTurn: true })).toEqual([{ sound: "turn", delayMs: 0 }]);
    expect(soundsFor({ ...quiet, myTurn: true }, { ...quiet, myTurn: true })).toEqual([]);
    expect(soundsFor({ ...quiet, myTurn: true }, quiet)).toEqual([]);
  });

  it("marks the end of a round, and the end of the match differently", () => {
    expect(names(soundsFor(quiet, { ...quiet, result: ended(false) }))).toEqual(["round"]);
    expect(names(soundsFor(quiet, { ...quiet, result: ended(true) }))).toEqual(["match"]);
    // The last card and the result arrive together: both are heard, card first.
    expect(
      names(soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind: "discard", result: ended(false) })),
    ).toEqual(["discard", "round"]);
    // A round's end is not also announced as the next player's turn.
    expect(names(soundsFor(quiet, { ...quiet, myTurn: true, result: ended(false) }))).toEqual([
      "round",
    ]);
  });

  it("lets the card sound be heard before the ding when the move hands over the turn", () => {
    // The usual case: the player before you discards, and it is your turn.
    expect(soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind: "discard", myTurn: true })).toEqual([
      { sound: "discard", delayMs: 0 },
      { sound: "turn", delayMs: 250 },
    ]);
    // A quarter of a second: long enough to hear both, short enough to read as one moment.
    expect(TURN_AFTER_CARD_MS).toBe(250);
    // The card itself is never held back.
    expect(soundsFor(quiet, { ...quiet, moveSeq: 2, moveKind: "draw" })).toEqual([
      { sound: "draw", delayMs: 0 },
    ]);
  });
});

// A stand-in AudioContext that records each oscillator: its pitch, when it starts,
// and the gain envelope it is shaped by.
function synthContext() {
  const voices: { frequency: number; start: number; peak: number; silentAt: number }[] = [];
  const ctx = {
    currentTime: 2,
    destination: {},
    createOscillator: () => {
      const osc = {
        type: "",
        frequency: { value: 0 },
        level: null as null | { peak: number; silentAt: number },
        connect: (gain: { env: { peak: number; silentAt: number } }) => {
          osc.level = gain.env;
          return gain;
        },
        start: (at: number) =>
          voices.push({ frequency: osc.frequency.value, start: at, ...osc.level! }),
        stop: () => {},
      };
      return osc;
    },
    createGain: () => {
      const env = { peak: 0, silentAt: 0 };
      return {
        env,
        gain: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: (v: number) => (env.peak = Math.max(env.peak, v)),
          exponentialRampToValueAtTime: (_: number, at: number) => (env.silentAt = at),
        },
        connect: (next: unknown) => next,
      };
    },
  };
  return { ctx: ctx as unknown as AudioContext, voices };
}

describe("the turn's ding", () => {
  it("rings like a bell: inharmonic partials, louder than a reaction, dying away over a second", () => {
    const { ctx, voices } = synthContext();
    play(ctx, "turn", new Map());
    expect(voices.length).toBe(DING_PARTIALS.length);
    const strike = voices[0]!.frequency;
    const ratios = voices.map((v) => v.frequency / strike);
    // Not a chord: at least two partials sit off any whole-number multiple.
    expect(ratios.filter((r) => Math.abs(r - Math.round(r)) > 0.2).length).toBeGreaterThanOrEqual(
      2,
    );
    // The strike note rings longest, about 1.2s; higher partials die first.
    expect(voices[0]!.silentAt - voices[0]!.start).toBeCloseTo(1.2, 5);
    const decays = voices.slice(1).map((v) => v.silentAt - v.start);
    expect(decays).toEqual([...decays].sort((a, b) => b - a));

    const blip = synthContext();
    play(blip.ctx, "reaction", new Map());
    const loudest = (vs: { peak: number }[]) => vs.reduce((sum, v) => sum + v.peak, 0);
    expect(loudest(voices)).toBeGreaterThan(3 * loudest(blip.voices));
  });

  it("starts when it is told to, on the audio clock", () => {
    const { ctx, voices } = synthContext();
    play(ctx, "turn", new Map(), 0.25);
    for (const v of voices) expect(v.start).toBeCloseTo(2.26, 5);
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
  const laugh = { name: "laugh" } as unknown as AudioBuffer;
  const recordings = new Map<Recorded, AudioBuffer>([
    ["draw", draw],
    ["discard", discard],
    ["emote-laugh", laugh],
  ]);

  it("plays an emote's own recording, once", () => {
    const { ctx, played } = fakeContext();
    play(ctx, "emote-laugh", recordings);
    expect(played).toEqual([{ buffer: laugh, rate: 1 }]);
  });

  it("stands the blip in for an emote whose recording has not loaded", () => {
    const tones = synthContext();
    play(tones.ctx, "emote-cry", recordings);
    expect(tones.voices.length).toBe(2);
    const blip = synthContext();
    play(blip.ctx, "reaction", new Map());
    expect(tones.voices).toEqual(blip.voices);
  });

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

describe("the sound a reaction makes", () => {
  it("is an emote's own sound, for anyone's emote, mine too", () => {
    expect(reactionSound("laugh", false, 0, [])).toEqual({
      sound: "emote-laugh",
      playing: [1_800],
    });
    expect(reactionSound("cool", true, 100, []).sound).toBe("emote-cool");
    // Each recording is cut to this; pinned, since the files were cut by hand.
    expect(EMOTE_SOUND_MS).toBe(1_800);
  });

  it("is the soft blip for another player's phrase, or an old page's emoji, never my own", () => {
    expect(reactionSound("nice", false, 0, [])).toEqual({ sound: "reaction", playing: [] });
    expect(reactionSound("fire", false, 0, [])).toEqual({ sound: "reaction", playing: [] });
    expect(reactionSound("nice", true, 0, [])).toEqual({ sound: null, playing: [] });
  });

  it("is nothing for an id this page does not know", () => {
    expect(reactionSound("brand-new", false, 0, [])).toEqual({ sound: null, playing: [] });
  });

  it("lets two emote sounds overlap and no more, until one has finished", () => {
    expect(EMOTE_SOUNDS_AT_ONCE).toBe(2);
    const one = reactionSound("laugh", false, 0, []);
    const two = reactionSound("cry", false, 500, one.playing);
    expect(two).toEqual({ sound: "emote-cry", playing: [1_800, 2_300] });
    const three = reactionSound("wow", false, 1_000, two.playing);
    expect(three).toEqual({ sound: null, playing: [1_800, 2_300] });
    // A phrase still blips meanwhile, and leaves the emotes as they were.
    expect(reactionSound("bruh", false, 1_000, two.playing)).toEqual({
      sound: "reaction",
      playing: [1_800, 2_300],
    });
    // The first ends at 1800, so at 1800 there is room again, and it is forgotten.
    expect(reactionSound("wow", false, 1_800, two.playing)).toEqual({
      sound: "emote-wow",
      playing: [2_300, 3_600],
    });
  });
});
