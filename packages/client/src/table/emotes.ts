/**
 * The emotes: big animated expressions of the sender's own face, as Clash Royale
 * draws its emotes. Each is the player's avatar (their skin, hair, hat, background
 * and, where it can stay, their glasses or facial hair) with the expression drawn
 * over it: eyes, mouth, and extras such as tears, a sweat drop, sunglasses or
 * confetti, moved by one motion for the whole face.
 *
 * This module is the model only, pure and tested: what each emote looks like, and
 * how it lands on a given face. `EmoteFace.tsx` draws it.
 */
import { PICKER_EMOTES, type Avatar } from "@hf/shared";

/** An emote's id: one of the picker's emotes, which reuse the old emoji ids. */
export type EmoteId = (typeof PICKER_EMOTES)[number];

/**
 * The eyes an emote draws in place of the player's own, or `own` to keep theirs.
 * Each comes with its brows where the expression needs them.
 */
export type EmoteEyes =
  | "own"
  | "squeezed" // > <, laughing too hard to look
  | "sobbing" // shut tight, brows raised in the middle
  | "glare" // small and fixed, brows down hard
  | "wide" // big and round, brows up
  | "happy" // ^ ^
  | "wince"; // one squeezed shut, one peeking

export type EmoteMouth =
  | "laugh" // wide open, top teeth and tongue
  | "wail" // open and turned down
  | "snarl" // teeth gritted
  | "grin" // a broad toothy smile
  | "gape" // jaw dropped
  | "cheer" // open and round
  | "grimace" // teeth clenched wide
  | "smirk"; // one corner up

/** What is drawn on, around or over the face. */
export type EmoteExtra =
  | "joy-tears" // drops flying from the corners of the eyes
  | "tear-streams" // tears running down both cheeks
  | "flush" // the face goes red
  | "steam" // puffs from the head
  | "thumb" // a hand pops in with its thumb up
  | "arms-up" // both arms thrown up
  | "confetti" // falling around the face
  | "sweat" // a drop sliding down the brow
  | "sunglasses"; // dropped on from above

/** How the whole face moves. Reduced motion holds it still. */
export type EmoteMotion =
  | "shake" // laughing: rocks side to side
  | "sob" // heaves up and down
  | "rage" // trembles, fast
  | "nod" // one firm nod
  | "jolt" // jumps back in surprise
  | "bounce" // jumps for joy
  | "cringe" // shrinks and tilts away
  | "tilt"; // leans back, pleased with itself

export interface Emote {
  readonly eyes: EmoteEyes;
  readonly mouth: EmoteMouth;
  readonly extras: readonly EmoteExtra[];
  readonly motion: EmoteMotion;
}

/** Each emote's expression, as the user asked for it. */
export const EMOTES: Readonly<Record<EmoteId, Emote>> = {
  laugh: { eyes: "squeezed", mouth: "laugh", extras: ["joy-tears"], motion: "shake" },
  cry: { eyes: "sobbing", mouth: "wail", extras: ["tear-streams"], motion: "sob" },
  angry: { eyes: "glare", mouth: "snarl", extras: ["flush", "steam"], motion: "rage" },
  "thumbs-up": { eyes: "happy", mouth: "grin", extras: ["thumb"], motion: "nod" },
  wow: { eyes: "wide", mouth: "gape", extras: [], motion: "jolt" },
  party: { eyes: "happy", mouth: "cheer", extras: ["arms-up", "confetti"], motion: "bounce" },
  grimace: { eyes: "wince", mouth: "grimace", extras: ["sweat"], motion: "cringe" },
  cool: { eyes: "own", mouth: "smirk", extras: ["sunglasses"], motion: "tilt" },
};

/** Whether a reaction's id is one of the drawn emotes (rather than a phrase or an old emoji). */
export function isEmote(id: string): id is EmoteId {
  return (PICKER_EMOTES as readonly string[]).includes(id);
}

/** An emote as it lands on one player's face: what to draw, and what of theirs to keep. */
export interface EmoteLook {
  readonly eyes: EmoteEyes;
  /** Their own shades stay on, over whatever the eyes are doing. */
  readonly shades: boolean;
  /** Their own glasses stay on, drawn over the expression's eyes. */
  readonly glasses: boolean;
  readonly mouth: EmoteMouth;
  /** Their moustache or beard stays, under the expression's mouth. */
  readonly facialHair: "moustache" | "beard" | null;
  readonly extras: readonly EmoteExtra[];
  /** Null when the face holds still: reduced motion, or a picture in the picker. */
  readonly motion: EmoteMotion | null;
}

/**
 * The emote `id` on `avatar`'s face. The expression replaces the eyes and mouth,
 * but what the player wears stays theirs: shades and glasses (unless the emote
 * puts its own sunglasses on), a moustache or a beard. `still` holds the face
 * and everything on it still (reduced motion; the picker's pictures).
 */
export function emoteLook(avatar: Avatar, id: EmoteId, still: boolean): EmoteLook {
  const emote = EMOTES[id];
  const sunglasses = emote.extras.includes("sunglasses");
  return {
    eyes: emote.eyes,
    shades: avatar.eyes === "shades" && !sunglasses,
    glasses: avatar.eyes === "glasses" && !sunglasses,
    mouth: emote.mouth,
    facialHair: avatar.mouth === "moustache" || avatar.mouth === "beard" ? avatar.mouth : null,
    extras: emote.extras,
    motion: still ? null : emote.motion,
  };
}
