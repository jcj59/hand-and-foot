// A player's picture: a small face put together from a fixed set of parts and
// colours, drawn as SVG by the client.
//
// Built from parts rather than uploaded, so there is no image to store, scale or
// moderate, and the whole picture is a handful of short ids — small enough to
// travel with every seat in `RoomInfo`. Like reactions, the lists only ever grow:
// an avatar chosen today must still be one tomorrow, so a part is never removed or
// renamed, and anything unrecognised is dropped rather than refused.

/** Every part an avatar is made of, and the ids each may take. */
export const AVATAR_PARTS = {
  /** The disc behind the face. */
  background: ["teal", "sky", "violet", "rose", "amber", "lime", "slate", "coral"],
  skin: ["porcelain", "peach", "sand", "olive", "umber", "cocoa", "mint", "lilac"],
  eyes: ["dots", "round", "sleepy", "wink", "glasses", "shades", "stars", "lashes"],
  mouth: ["smile", "grin", "flat", "open", "tongue", "smirk", "moustache", "beard"],
  top: ["none", "short", "long", "bun", "curly", "cap", "beanie", "crown", "bow", "mohawk"],
} as const;

export type AvatarPart = keyof typeof AVATAR_PARTS;
export const AVATAR_PART_NAMES = Object.keys(AVATAR_PARTS) as AvatarPart[];

/** One avatar: an id for each part. */
export type Avatar = { readonly [P in AvatarPart]: (typeof AVATAR_PARTS)[P][number] };

/** Whether an untyped value is an avatar made only of known parts, and nothing else. */
export function isAvatar(value: unknown): value is Avatar {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  return (
    keys.length === AVATAR_PART_NAMES.length &&
    AVATAR_PART_NAMES.every((part) =>
      (AVATAR_PARTS[part] as readonly string[]).includes(v[part] as string),
    )
  );
}

/**
 * An avatar from whatever a request carried, copied part by part so nothing else
 * comes along with it — or null when it is not one. A seat is never refused over a
 * picture; it simply goes without, and is drawn from the player's name instead.
 */
export function parseAvatar(value: unknown): Avatar | null {
  if (!isAvatar(value)) return null;
  const out = {} as Record<AvatarPart, string>;
  for (const part of AVATAR_PART_NAMES) out[part] = value[part];
  return out as Avatar;
}

/**
 * The avatar of someone who has not chosen one: picked from a hash of a seed (a
 * name, usually), so the same player looks the same on every screen and every
 * visit, and two players at a table rarely match.
 */
export function defaultAvatar(seed: string): Avatar {
  // FNV-1a, then a mulberry-style mix per part, so neighbouring names differ in
  // every part rather than only the last.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  const out = {} as Record<AvatarPart, string>;
  AVATAR_PART_NAMES.forEach((part, i) => {
    let t = (h + Math.imul(i + 1, 0x6d2b79f5)) | 0;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    const ids = AVATAR_PARTS[part] as readonly string[];
    out[part] = ids[((t ^ (t >>> 14)) >>> 0) % ids.length]!;
  });
  return out as Avatar;
}
