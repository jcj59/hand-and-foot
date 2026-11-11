/**
 * Profile's player card: the face and name this device sits down with, changed
 * here and kept at once, the way the card before a seat changes them.
 *
 * On a phone it is a row (the face with Shuffle on it, the name beside it) over
 * the colors; on a computer the face, colors and name stack, centered, with the
 * player's initial in two corners like a playing card's index. "Choose each part"
 * opens the full `AvatarEditor`, so every part stays choosable here too.
 */
import { useState, type CSSProperties } from "react";
import { AVATAR_PARTS, MAX_NAME_LENGTH, defaultAvatar, type Avatar } from "@hf/shared";
import { AvatarFace, BACKGROUND_COLORS } from "./Avatar";
import { AvatarEditor, randomAvatar } from "./AvatarEditor";
import { CornerIndex } from "./PlayerCard";
import { Icon } from "../ui/icons";

export interface ProfileCardProps {
  readonly phone: boolean;
  readonly name: string;
  readonly onName: (name: string) => void;
  /** The chosen face, or null for the one drawn from the name. */
  readonly avatar: Avatar | null;
  readonly onAvatar: (avatar: Avatar | null) => void;
  /** Injectable for tests. */
  readonly random?: () => number;
}

const CARD_BACKGROUND: CSSProperties = {
  background: "linear-gradient(160deg, #1C3A2F, var(--color-surface) 70%)",
};

export function ProfileCard({
  phone,
  name,
  onName,
  avatar,
  onAvatar,
  random,
}: ProfileCardProps): React.ReactElement {
  const face = avatar ?? defaultAvatar(name.trim() || "?");
  const [parts, setParts] = useState(false);
  const label = `${name.trim() || "Your"} picture`;

  const shuffle = (size: number, glyph: number, place: string): React.ReactElement => (
    <button
      type="button"
      aria-label="Shuffle"
      onClick={() => onAvatar(randomAvatar(random))}
      className={`absolute ${place} flex items-center justify-center rounded-full border-[3px] border-[#1A2C26] bg-accent text-accent-ink hover:bg-accent-hover`}
      style={{ width: size, height: size }}
    >
      <Icon name="shuffle" size={glyph} />
    </button>
  );

  const swatches = (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap justify-center gap-2.5">
      {AVATAR_PARTS.background.map((color) => {
        const on = face.background === color;
        const hex = BACKGROUND_COLORS[color];
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={color}
            onClick={() => onAvatar({ ...face, background: color })}
            className={`rounded-full border-[3px] p-0 ${phone ? "size-[30px]" : "size-8"} ${on ? "border-card" : "border-transparent"}`}
            style={{ background: hex, boxShadow: on ? `0 0 0 2px ${hex}` : "none" }}
          />
        );
      })}
    </div>
  );

  const editor = (
    <>
      <button
        type="button"
        onClick={() => setParts(!parts)}
        aria-expanded={parts}
        className="self-center text-xs text-muted underline hover:text-ink"
      >
        {parts ? "Done choosing parts" : "Choose each part"}
      </button>
      {parts && (
        <div className="w-full">
          <AvatarEditor name={name} avatar={avatar} onChange={onAvatar} random={random} open />
        </div>
      )}
    </>
  );

  const input = (
    <input
      value={name}
      onChange={(e) => onName(e.target.value)}
      placeholder="Your name"
      maxLength={MAX_NAME_LENGTH}
      className={`w-full rounded-xl border border-white/16 bg-black/25 font-display font-semibold text-card placeholder:text-faint ${
        phone ? "min-h-[46px] px-3 text-lg" : "min-h-[50px] rounded-[14px] px-4 text-center text-xl"
      }`}
    />
  );

  if (phone) {
    return (
      <section
        aria-label="Your player card"
        className="flex flex-col gap-3.5 rounded-[22px] border border-white/10 p-[18px]"
        style={CARD_BACKGROUND}
      >
        <div className="flex items-center gap-3.5">
          <div className="relative shrink-0">
            <AvatarFace avatar={face} size={72} label={label} />
            {shuffle(36, 14, "-right-2 -bottom-1.5")}
          </div>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs text-muted">Name at the table</span>
            {input}
          </label>
        </div>
        {swatches}
        {editor}
      </section>
    );
  }

  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <section
      aria-label="Your player card"
      className="relative flex flex-col items-center gap-4 rounded-3xl border border-white/10 px-6 pt-7 pb-6"
      style={CARD_BACKGROUND}
    >
      <CornerIndex initial={initial} />
      <span
        aria-hidden="true"
        className="absolute right-4 bottom-3.5 rotate-180 font-mono text-[15px] font-bold text-white/35"
      >
        {initial}
      </span>
      <div className="relative">
        <span className="block rounded-full shadow-[0_0_0_6px_rgba(255,255,255,0.06)]">
          <AvatarFace avatar={face} size={104} label={label} />
        </span>
        {shuffle(44, 18, "-right-1.5 -bottom-0.5")}
      </div>
      {swatches}
      <label className="flex w-full flex-col gap-1.5">
        <span className="text-center text-xs text-muted">Name at the table</span>
        {input}
      </label>
      {editor}
    </section>
  );
}
