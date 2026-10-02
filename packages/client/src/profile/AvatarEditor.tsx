/**
 * Choosing a picture, on the home screen: the face as it will be seen, and, folded
 * away until wanted, a row of choices for each part — each choice drawn as the
 * whole face with that one part changed, so a player picks by looking rather than
 * by reading names. Until they choose, the face is the one their name gives them.
 */
import { useState } from "react";
import {
  AVATAR_PART_NAMES,
  AVATAR_PARTS,
  defaultAvatar,
  type Avatar,
  type AvatarPart,
} from "@hf/shared";
import { AvatarFace } from "./Avatar";

const PART_LABEL: Record<AvatarPart, string> = {
  background: "Background",
  skin: "Face",
  eyes: "Eyes",
  mouth: "Mouth",
  top: "Hair or hat",
};

/** A random avatar, for "Shuffle". `random` is injectable so a test can know what it gets. */
export function randomAvatar(random: () => number = Math.random): Avatar {
  const out = {} as Record<AvatarPart, string>;
  for (const part of AVATAR_PART_NAMES) {
    const ids = AVATAR_PARTS[part] as readonly string[];
    out[part] = ids[Math.floor(random() * ids.length)]!;
  }
  return out as Avatar;
}

export function AvatarEditor({
  name,
  avatar,
  onChange,
  random,
}: {
  /** What a face is drawn from until one is chosen. */
  readonly name: string;
  /** The chosen face, or null for none yet. */
  readonly avatar: Avatar | null;
  readonly onChange: (avatar: Avatar | null) => void;
  readonly random?: () => number;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const face = avatar ?? defaultAvatar(name.trim());
  return (
    <section aria-label="Your picture" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <AvatarFace avatar={face} size={56} label="Your picture" />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="rounded border border-white/25 px-3 py-1 text-sm"
          >
            {open ? "Done" : "Change picture"}
          </button>
          {open && (
            <button
              type="button"
              onClick={() => onChange(randomAvatar(random))}
              className="rounded border border-white/25 px-3 py-1 text-sm"
            >
              Shuffle
            </button>
          )}
          {open && avatar && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded border border-white/25 px-3 py-1 text-sm"
            >
              Use the one from my name
            </button>
          )}
        </div>
      </div>
      {open &&
        AVATAR_PART_NAMES.map((part) => (
          <div
            key={part}
            role="group"
            aria-label={PART_LABEL[part]}
            className="flex flex-col gap-1"
          >
            <span className="text-xs text-white/60">{PART_LABEL[part]}</span>
            {/* One row that scrolls sideways, so a phone keeps every choice at a usable size. */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {(AVATAR_PARTS[part] as readonly Avatar[typeof part][]).map((id) => {
                const chosen = face[part] === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={`${PART_LABEL[part]}: ${id}`}
                    aria-pressed={chosen}
                    onClick={() => onChange({ ...face, [part]: id })}
                    className={`shrink-0 rounded-full p-0.5 ${chosen ? "ring-2 ring-amber-300" : "ring-1 ring-white/15"}`}
                  >
                    <AvatarFace avatar={{ ...face, [part]: id }} size={36} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
    </section>
  );
}
