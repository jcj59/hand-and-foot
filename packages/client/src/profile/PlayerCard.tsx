/**
 * Your player card: the face and name the table will see you as, before you sit
 * down. It is the step between choosing a table (joining one by its code, or
 * opening one) and taking a seat at it.
 *
 * Two looks. Editing: the face large, Shuffle on it, a row of colors (the face's
 * background), "Choose each part" for the rest, and the name. A device signed in
 * to an account starts instead on the finished card, with its record, and "Sit
 * down as <name>"; "Change picture or name" turns it back into the editor.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AVATAR_PARTS, MAX_NAME_LENGTH, defaultAvatar, type Avatar } from "@hf/shared";
import { AvatarFace, BACKGROUND_COLORS } from "./Avatar";
import { AvatarEditor, randomAvatar } from "./AvatarEditor";
import { Icon } from "../ui/icons";

export interface CardStats {
  readonly games: number;
  readonly won: number | null;
  readonly awards: number;
}

export interface PlayerCardProps {
  readonly name: string;
  readonly onName: (name: string) => void;
  /** The chosen face, or null for the one drawn from the name. */
  readonly avatar: Avatar | null;
  readonly onAvatar: (avatar: Avatar | null) => void;
  /** The username this device is signed in as, if any. */
  readonly account: string | null;
  readonly stats: CardStats | null;
  /** Shown as the editor (true) or as the finished card (false). */
  readonly editing: boolean;
  /** Injectable for tests. */
  readonly random?: () => number;
}

export function PlayerCard({
  name,
  onName,
  avatar,
  onAvatar,
  account,
  stats,
  editing,
  random,
}: PlayerCardProps): React.ReactElement {
  const face = avatar ?? defaultAvatar(name.trim() || "?");
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const [parts, setParts] = useState(false);

  if (!editing) {
    return (
      <section
        aria-label="Your player card"
        className="relative flex flex-col items-center gap-3 overflow-hidden rounded-[28px] p-5 pb-6"
        style={{
          background: `radial-gradient(120% 90% at 85% 10%, ${BACKGROUND_COLORS[face.background]}CC, ${BACKGROUND_COLORS[face.background]}55 55%, #1A1F24)`,
        }}
      >
        <CornerIndex initial={initial} />
        {account && (
          <span className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-black/25 px-3 py-1 text-sm font-semibold">
            <Icon name="check" size={14} />@{account}
          </span>
        )}
        <span className="mt-2 rounded-full bg-white/15 p-2">
          <AvatarFace avatar={face} size={112} label={`${name.trim() || "Your"} picture`} />
        </span>
        <p className="m-0 font-display text-[32px] font-bold">{name.trim()}</p>
        {stats && (
          <dl className="m-0 grid w-full grid-cols-3 gap-2">
            {(
              [
                [String(stats.games), "games"],
                [stats.won === null ? "–" : `${stats.won}%`, "won"],
                [String(stats.awards), "awards"],
              ] as const
            ).map(([value, label]) => (
              <div key={label} className="flex flex-col items-center rounded-2xl bg-black/25 py-2">
                <dd className="m-0 font-display text-xl font-bold">{value}</dd>
                <dt className="text-xs">{label}</dt>
              </div>
            ))}
          </dl>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Your player card"
      className="relative flex flex-col items-center gap-4 rounded-[28px] border border-white/10 p-5 pb-6"
      style={{ background: "linear-gradient(160deg, #1D3A2E, #15191D 65%)" }}
    >
      <CornerIndex initial={initial} />
      <div className="relative mt-2">
        <span className="block rounded-full bg-black/20 p-2">
          <AvatarFace avatar={face} size={112} label={`${name.trim() || "Your"} picture`} />
        </span>
        <button
          type="button"
          aria-label="Shuffle"
          onClick={() => onAvatar(randomAvatar(random))}
          className="absolute right-0 bottom-0 flex size-10 items-center justify-center rounded-full border-4 border-sheet bg-accent text-accent-ink hover:bg-accent-hover"
        >
          <Icon name="shuffle" size={18} />
        </button>
      </div>
      <div role="radiogroup" aria-label="Color" className="flex flex-wrap justify-center gap-1.5">
        {AVATAR_PARTS.background.map((color) => {
          const on = face.background === color;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={color}
              onClick={() => onAvatar({ ...face, background: color })}
              className={`size-7 rounded-full ${on ? "ring-2 ring-offset-2 ring-offset-sheet" : ""}`}
              style={{
                background: BACKGROUND_COLORS[color],
                ...(on ? { ["--tw-ring-color" as string]: BACKGROUND_COLORS[color] } : {}),
              }}
            />
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setParts(!parts)}
        aria-expanded={parts}
        className="text-xs text-muted underline hover:text-ink"
      >
        {parts ? "Done choosing parts" : "Choose each part"}
      </button>
      {parts && (
        <div className="w-full">
          <AvatarEditor name={name} avatar={avatar} onChange={onAvatar} random={random} open />
        </div>
      )}
      <label className="flex w-full flex-col items-center gap-1.5">
        <span className="text-sm text-muted">Name at the table</span>
        <input
          className="min-h-14 w-full rounded-2xl border border-white/12 bg-page px-4 text-center font-display text-2xl font-semibold text-ink placeholder:text-faint"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
        />
      </label>
    </section>
  );
}

/** The card's corner index: the player's initial, as a playing card has its rank. */
export function CornerIndex({ initial }: { readonly initial: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="absolute top-4 left-5 font-mono text-lg font-bold text-white/35"
    >
      {initial}
    </span>
  );
}

/** Under the card: what keeping this face means, and a way to be the same player elsewhere. */
export function CardNote({ account }: { readonly account: string | null }): React.ReactElement {
  return account ? (
    <p className="m-0 text-center text-sm text-muted">
      Not you?{" "}
      <Link to="/profile" className="text-accent underline hover:text-accent-hover">
        Switch account
      </Link>
    </p>
  ) : (
    <p className="m-0 text-center text-sm text-muted">
      Remembered on this device.{" "}
      <Link to="/profile" className="text-accent underline hover:text-accent-hover">
        Sign in
      </Link>{" "}
      to be you everywhere.
    </p>
  );
}
