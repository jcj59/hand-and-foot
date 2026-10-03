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
      <p className="text-3xl font-black text-amber-200 sm:text-4xl">Awards</p>
      <ul className="flex flex-col gap-1 text-left">
        {shown.map((award) => (
          <li key={award.id} className="text-base sm:text-lg">
            <span className="font-semibold text-amber-100">{award.title}:</span>{" "}
            {winnersOf(award, nameOf)}
          </li>
        ))}
      </ul>
    </Celebration>
  );
}
