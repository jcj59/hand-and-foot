import { describe, expect, it } from "vitest";
import { PICKER_EMOTES, type Avatar } from "@hf/shared";
import { EMOTES, emoteLook, isEmote } from "./emotes";

const plain: Avatar = {
  background: "teal",
  skin: "peach",
  eyes: "dots",
  mouth: "smile",
  top: "short",
};

describe("the emotes", () => {
  it("are the picker's eight, each with the expression the user described", () => {
    expect(Object.keys(EMOTES).sort()).toEqual([...PICKER_EMOTES].sort());
    // Pinned whole: each line is the user's own description of that emote.
    expect(EMOTES).toEqual({
      laugh: { eyes: "squeezed", mouth: "laugh", extras: ["joy-tears"], motion: "shake" },
      cry: { eyes: "sobbing", mouth: "wail", extras: ["tear-streams"], motion: "sob" },
      angry: { eyes: "glare", mouth: "snarl", extras: ["flush", "steam"], motion: "rage" },
      "thumbs-up": { eyes: "happy", mouth: "grin", extras: ["thumb"], motion: "nod" },
      wow: { eyes: "wide", mouth: "gape", extras: [], motion: "jolt" },
      party: {
        eyes: "happy",
        mouth: "cheer",
        extras: ["arms-up", "confetti"],
        motion: "bounce",
      },
      grimace: { eyes: "wince", mouth: "grimace", extras: ["sweat"], motion: "cringe" },
      cool: { eyes: "own", mouth: "smirk", extras: ["sunglasses"], motion: "tilt" },
    });
  });

  it("are told from phrases, old emoji and ids this page does not know", () => {
    for (const id of PICKER_EMOTES) expect(isEmote(id)).toBe(true);
    for (const id of ["nice", "oops", "fire", "pray", "wow-phrase", "brand-new", ""]) {
      expect(isEmote(id)).toBe(false);
    }
  });
});

describe("an emote on a player's face", () => {
  it("draws the emote's eyes, mouth, extras and motion on a plain face", () => {
    expect(emoteLook(plain, "laugh", false)).toEqual({
      eyes: "squeezed",
      shades: false,
      glasses: false,
      mouth: "laugh",
      facialHair: null,
      extras: ["joy-tears"],
      motion: "shake",
    });
  });

  it("holds still when asked: reduced motion, and the picker's pictures", () => {
    expect(emoteLook(plain, "party", true).motion).toBeNull();
    expect(emoteLook(plain, "party", true).extras).toEqual(["arms-up", "confetti"]);
  });

  it("keeps the player's own shades and glasses on, unless the emote brings sunglasses", () => {
    const shades = { ...plain, eyes: "shades" } as const;
    const glasses = { ...plain, eyes: "glasses" } as const;
    expect(emoteLook(shades, "cry", false)).toMatchObject({ shades: true, glasses: false });
    expect(emoteLook(glasses, "cry", false)).toMatchObject({ shades: false, glasses: true });
    expect(emoteLook(shades, "cool", false)).toMatchObject({ shades: false, glasses: false });
    expect(emoteLook(glasses, "cool", false)).toMatchObject({ shades: false, glasses: false });
    expect(emoteLook(plain, "cry", false)).toMatchObject({ shades: false, glasses: false });
  });

  it("keeps a moustache or a beard under the emote's mouth", () => {
    expect(emoteLook({ ...plain, mouth: "beard" }, "wow", false).facialHair).toBe("beard");
    expect(emoteLook({ ...plain, mouth: "moustache" }, "wow", false).facialHair).toBe("moustache");
    expect(emoteLook({ ...plain, mouth: "grin" }, "wow", false).facialHair).toBeNull();
    // Whatever the face's mouth, the emote's is drawn.
    expect(emoteLook({ ...plain, mouth: "beard" }, "wow", false).mouth).toBe("gape");
  });
});
