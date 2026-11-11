/**
 * The awards when a match ends: announced over the table on every screen, on the
 * celebration overlay, then kept on the final scoreboard.
 *
 * Shown only for a match that ends while the page is open — not for one the page
 * opened on already over, nor on a replay's silent jump — as the other
 * celebrations are.
 */
import { useEffect, useRef, useState } from "react";
import { awards, type Award, type RoundEnded } from "@hf/shared";
import { Celebration } from "./Celebration";

/** How long the awards stay up. */
export const AWARDS_MS = 6_000;

/** The awards a final result earns, leaving out anyone who left before the end. */
export function awardsOf(result: RoundEnded): Award[] {
  if (!result.matchOver || !result.tallies) return [];
  const gone = new Set((result.departed ?? []).map((d) => d.seat));
  return awards(result.tallies, (seat) => gone.has(seat));
}

/** The awards in words: "Ana and Ben (2 clean books)". */
export function winnersOf(award: Award, nameOf: (seat: number) => string): string {
  const names = award.seats.map(nameOf);
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
  return `${who} (${award.what})`;
}

export function useAwardsCelebration(result: RoundEnded | null, quiet: boolean): Award[] | null {
  const [shown, setShown] = useState<Award[] | null>(null);
  // The result the page opened on is not news.
  const seen = useRef(result?.matchOver ?? false);
  useEffect(() => {
    const over = result?.matchOver ?? false;
    if (!over) {
      seen.current = false;
      return;
    }
    if (seen.current) return;
    seen.current = true;
    const earned = result ? awardsOf(result) : [];
    if (quiet || earned.length === 0) return;
    setShown(earned);
  }, [result, quiet]);
  // Timed by the showing, not by the result, which the server may send again.
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), AWARDS_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return shown;
}

export function AwardsCelebration({
  shown,
  nameOf,
}: {
  readonly shown: readonly Award[];
  readonly nameOf: (seat: number) => string;
}): React.ReactElement {
  return (
    <Celebration label="Awards" ms={AWARDS_MS} confetti>
      <p className="m-0 font-display text-[34px] font-bold tracking-[-0.02em] text-gold-soft">
        Awards
      </p>
      <ul className="m-0 flex w-full list-none flex-col gap-2 p-0 text-left">
        {shown.map((award) => (
          <li key={award.id} className="flex items-center gap-2.5">
            <AwardIcon id={award.id} size={34} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{award.title}</span>
              <span className="block text-xs text-muted">{winnersOf(award, nameOf)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Celebration>
  );
}

/** Each award's drawing and color, as the design gives them. */
const AWARD_ICON: Record<string, { readonly d: string; readonly color: string }> = {
  grabby: {
    d: "M7 11V6a1.5 1.5 0 0 1 3 0v5M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.6-1.5L7 13",
    color: "#F2C14E",
  },
  marva: {
    d: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
    color: "#F59E8B",
  },
  clean: {
    d: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
    color: "#7CD9C0",
  },
  out: { d: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10", color: "#4ADE9B" },
  pile: { d: "M4 15l8 4 8-4M4 11l8 4 8-4M4 7l8 4 8-4-8-4z", color: "#8FB8E8" },
  "red-threes": { d: "M8 5h5a3.5 3.5 0 0 1 0 7h-3h3a3.5 3.5 0 0 1 0 7H8", color: "#E5484D" },
};

/** An award's own color, which tints its icon and, on Profile, its tile. */
export function awardColor(id: string): string {
  return (AWARD_ICON[id] ?? AWARD_ICON.out!).color;
}

export function AwardIcon({
  id,
  size,
  earned = true,
  glyph = size / 2,
}: {
  readonly id: string;
  readonly size: number;
  /** False draws it gray, for an award not won yet. */
  readonly earned?: boolean;
  /** The drawing's own size inside its box. */
  readonly glyph?: number;
}): React.ReactElement {
  const icon = AWARD_ICON[id] ?? AWARD_ICON.out!;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: earned ? `${icon.color}2E` : "rgba(255,255,255,0.05)",
        color: earned ? icon.color : "var(--color-faint)",
      }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icon.d} />
      </svg>
    </span>
  );
}
