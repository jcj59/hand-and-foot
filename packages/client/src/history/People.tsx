/**
 * The people on the History page: the faces under "Played with", each with their
 * first name, a "More" sheet listing everyone, and a card for one person with what
 * the player's own games with them say (`together.ts`). Choosing to see only the
 * games with someone is done from their card, so a face is always the way to them.
 */
import type { MatchListing } from "@hf/shared";
import { AvatarFace } from "../profile/Avatar";
import { faceOf } from "../profile/avatarStore";
import { Sheet } from "../ui/Sheet";
import type { Companion } from "./filters";
import { firstName, gamesCount, stat, together, lastPlayedLine } from "./together";

/** Which of the page's people sheets is open, if any. */
export type PeopleSheet =
  { readonly kind: "more" } | { readonly kind: "person"; readonly name: string };

/** One face under "Played with": the picture, ringed when chosen, the first name below. */
function FaceButton({
  person,
  chosen,
  wide,
  onOpen,
}: {
  readonly person: Companion;
  /** The slot's width class, which the name is truncated to. */
  readonly wide: string;
  readonly chosen: boolean;
  readonly onOpen: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={chosen ? `${person.name}, only your games with them shown` : person.name}
      title={person.name}
      onClick={onOpen}
      className={`group flex shrink-0 flex-col items-center gap-1 ${wide}`}
    >
      <span
        className={`rounded-full ${
          chosen
            ? "shadow-[0_0_0_2px_#14181C,0_0_0_4px_#4ADE9B]"
            : "opacity-60 group-hover:opacity-90"
        }`}
      >
        <AvatarFace avatar={faceOf(person)} size={36} />
      </span>
      <span
        className={`w-full truncate text-center text-[11px] leading-tight ${
          chosen ? "font-semibold text-ink" : "text-muted group-hover:text-ink-soft"
        }`}
      >
        {firstName(person.name)}
      </span>
    </button>
  );
}

/**
 * The "Played with" row: the most played with first, up to `shown` of them, plus
 * anyone chosen beyond those (so a chosen face never disappears), and "More" for
 * the rest.
 */
export function PeopleRow({
  everyone,
  shown,
  chosen,
  phone,
  onOpen,
}: {
  /** Everyone played with, most played with first. */
  readonly everyone: readonly Companion[];
  readonly shown: number;
  readonly chosen: readonly string[];
  readonly phone: boolean;
  readonly onOpen: (sheet: PeopleSheet) => void;
}): React.ReactElement {
  const wide = phone ? "w-11" : "w-10";
  const row = everyone.filter((p, i) => i < shown || chosen.includes(p.name));
  const rest = everyone.length - row.length;
  return (
    <div
      role="group"
      aria-label="Played with"
      className={`flex items-start gap-1 ${phone ? "no-scrollbar -mr-3 overflow-x-auto pr-3" : ""}`}
    >
      {phone && <span className="mt-2.5 mr-1 shrink-0 text-[11px] text-quiet">With</span>}
      {row.map((person) => (
        <FaceButton
          key={person.name}
          person={person}
          chosen={chosen.includes(person.name)}
          wide={wide}
          onOpen={() => onOpen({ kind: "person", name: person.name })}
        />
      ))}
      {rest > 0 && (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`Everyone you have played with (${rest} more)`}
          onClick={() => onOpen({ kind: "more" })}
          className={`group flex shrink-0 flex-col items-center gap-1 ${wide}`}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-white/8 text-[13px] font-semibold text-ink-soft group-hover:bg-white/14">
            +{rest}
          </span>
          <span className="text-[11px] leading-tight text-muted group-hover:text-ink-soft">
            More
          </span>
        </button>
      )}
    </div>
  );
}

/** Everyone the player has played with, each opening their card. */
export function MoreSheet({
  everyone,
  recent,
  chosen,
  onOpen,
  onClose,
}: {
  readonly everyone: readonly Companion[];
  readonly recent: readonly MatchListing[];
  readonly chosen: readonly string[];
  readonly onOpen: (name: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  return (
    <Sheet title="Played with" id="played-with" onClose={onClose}>
      <ul aria-label="Everyone you have played with" className="-mx-2 flex flex-col">
        {everyone.map((person) => {
          const on = chosen.includes(person.name);
          return (
            <li key={person.name}>
              <button
                type="button"
                onClick={() => onOpen(person.name)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/6"
              >
                <span
                  className={`shrink-0 rounded-full ${on ? "shadow-[0_0_0_2px_#1B2025,0_0_0_4px_#4ADE9B]" : ""}`}
                >
                  <AvatarFace avatar={faceOf(person)} size={40} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{person.name}</span>
                  <span className="block text-[13px] text-muted">
                    {gamesCount(together(recent, person.name)?.games ?? 0)} together
                    {on && " · shown"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/**
 * One person's card: their face, how many games together and when the last was,
 * then the two of them side by side over those games. It never claims to be their
 * record: it is only what this player's history holds, and a name is all a game
 * says about them, so it is worded as "your games together".
 */
export function PersonSheet({
  name,
  recent,
  chosen,
  onShow,
  onClose,
}: {
  readonly name: string;
  readonly recent: readonly MatchListing[];
  /** Whether History is showing only the games with this person. */
  readonly chosen: boolean;
  /** Show only the games with them, or every game again. */
  readonly onShow: () => void;
  readonly onClose: () => void;
}): React.ReactElement | null {
  const t = together(recent, name);
  if (!t) return null;
  const rows: [string, string, string][] = [
    ["Wins", String(t.them.wins), String(t.you.wins)],
    ["Average score", stat(t.them.average), stat(t.you.average)],
    ["Best score", stat(t.them.best), stat(t.you.best)],
  ];
  return (
    <Sheet title={name} id="person" onClose={onClose}>
      <div className="flex items-center gap-3.5">
        <AvatarFace avatar={faceOf(t)} size={64} />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{gamesCount(t.games)} together</p>
          <p className="text-[13px] text-muted">{lastPlayedLine(t)}</p>
          <p className="text-[13px] text-muted">From your games together</p>
        </div>
      </div>
      <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-white/8 text-sm">
        <thead>
          <tr className="bg-white/4">
            <th scope="col" className="px-3.5 py-2.5 text-left text-xs font-medium text-quiet">
              <span className="sr-only">Stat</span>
            </th>
            <th
              scope="col"
              className="max-w-[9rem] truncate px-3.5 py-2.5 text-right font-semibold"
            >
              {firstName(name)}
            </th>
            <th scope="col" className="px-3.5 py-2.5 text-right font-semibold">
              You
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, them, you]) => (
            <tr key={label}>
              <th
                scope="row"
                className="border-t border-white/6 px-3.5 py-2.5 text-left font-normal text-muted"
              >
                {label}
              </th>
              <td className="border-t border-white/6 px-3.5 py-2.5 text-right font-display text-base font-bold tabular-nums">
                {them}
              </td>
              <td className="border-t border-white/6 px-3.5 py-2.5 text-right font-display text-base font-bold tabular-nums">
                {you}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-quiet">
        Wins and scores count games played to the end. Anyone who played as {name} is counted.
      </p>
      <button
        type="button"
        onClick={onShow}
        className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${
          chosen
            ? "bg-white/8 text-ink hover:bg-white/12"
            : "bg-accent text-accent-ink hover:brightness-110"
        }`}
      >
        {chosen
          ? `Stop showing only games with ${firstName(name)}`
          : `Show our ${gamesCount(t.games)}`}
      </button>
    </Sheet>
  );
}
