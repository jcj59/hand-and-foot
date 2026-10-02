import { describe, it, expect } from "vitest";
import {
  AVATAR_PART_NAMES,
  AVATAR_PARTS,
  defaultAvatar,
  isAvatar,
  parseAvatar,
  type Avatar,
} from "./avatar";

const ANA: Avatar = {
  background: "teal",
  skin: "peach",
  eyes: "glasses",
  mouth: "grin",
  top: "bun",
};

describe("avatars", () => {
  it("are made of five parts, each with a fixed list of ids that only grows", () => {
    expect(AVATAR_PART_NAMES).toEqual(["background", "skin", "eyes", "mouth", "top"]);
    // Every id ever offered, pinned: an avatar someone chose must stay one.
    expect(AVATAR_PARTS).toEqual({
      background: ["teal", "sky", "violet", "rose", "amber", "lime", "slate", "coral"],
      skin: ["porcelain", "peach", "sand", "olive", "umber", "cocoa", "mint", "lilac"],
      eyes: ["dots", "round", "sleepy", "wink", "glasses", "shades", "stars", "lashes"],
      mouth: ["smile", "grin", "flat", "open", "tongue", "smirk", "moustache", "beard"],
      top: ["none", "short", "long", "bun", "curly", "cap", "beanie", "crown", "bow", "mohawk"],
    });
    for (const part of AVATAR_PART_NAMES) {
      expect(new Set(AVATAR_PARTS[part]).size).toBe(AVATAR_PARTS[part].length);
    }
  });

  it("recognise an avatar of known parts, and nothing else", () => {
    expect(isAvatar(ANA)).toBe(true);
    for (const bad of [
      null,
      undefined,
      "teal",
      [],
      [ANA],
      // An array dressed up with the five parts as named fields.
      Object.assign([], ANA),
      {},
      { ...ANA, eyes: "laser" },
      { ...ANA, top: undefined },
      { ...ANA, extra: "x" },
      { ...ANA, skin: 1 },
      Object.fromEntries(Object.entries(ANA).filter(([k]) => k !== "mouth")),
    ]) {
      expect(isAvatar(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("are copied out of a request part by part, or not at all", () => {
    expect(parseAvatar(ANA)).toEqual(ANA);
    expect(parseAvatar(ANA)).not.toBe(ANA);
    expect(parseAvatar({ ...ANA, eyes: "laser" })).toBeNull();
    expect(parseAvatar("ana")).toBeNull();
    // A prototype carrying a part does not count as having it.
    expect(parseAvatar(Object.create(ANA))).toBeNull();
  });

  it("give everyone without one a face of their own, the same every time", () => {
    const names = ["Ana", "Ben", "Cal", "Dee", "Eve", "Fay", "Gus", "Hal"];
    const faces = names.map(defaultAvatar);
    for (const face of faces) expect(isAvatar(face)).toBe(true);
    expect(names.map(defaultAvatar)).toEqual(faces);
    // Different names mostly look different, and in more than one part.
    expect(new Set(faces.map((f) => JSON.stringify(f))).size).toBe(names.length);
    const differing = AVATAR_PART_NAMES.filter(
      (p) => defaultAvatar("Ana")[p] !== defaultAvatar("Anb")[p],
    );
    expect(differing.length).toBeGreaterThan(1);
    expect(isAvatar(defaultAvatar(""))).toBe(true);
  });

  it("spread their default over every id of every part", () => {
    const seen = Object.fromEntries(AVATAR_PART_NAMES.map((p) => [p, new Set<string>()]));
    for (let i = 0; i < 2_000; i++) {
      const face = defaultAvatar(`player-${i}`);
      for (const p of AVATAR_PART_NAMES) seen[p]!.add(face[p]);
    }
    for (const p of AVATAR_PART_NAMES) expect(seen[p]!.size).toBe(AVATAR_PARTS[p].length);
  });
});
