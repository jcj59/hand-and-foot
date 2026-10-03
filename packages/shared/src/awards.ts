// The awards at the end of a match: who did the most of the things a table talks
// about afterwards. Worked out from the same per-seat tallies the stats are, so an
// award and a player's stats can never disagree.

import type { SeatTally } from "./matches";

export interface Award {
  readonly id: string;
  readonly title: string;
  /** Who won it — more than one on a tie. */
  readonly seats: readonly number[];
  readonly count: number;
  /** What it counts, for the number: "3 times", "4 clean books". */
  readonly what: string;
}

type Counted = keyof Required<SeatTally>;

/**
 * The awards a match earns, in the order they are announced. One goes to whoever
 * did the most of something, shared on a tie, and only once somebody has done it
 * at all — nobody is the Grabby Pants champion of a match without Grabby Pants.
 */
export const AWARDS: readonly {
  readonly id: string;
  readonly title: string;
  readonly counts: Counted;
  readonly what: (n: number) => string;
}[] = [
  {
    id: "grabby",
    title: "Grabby Pants champion",
    counts: "grabbyPants",
    what: (n) => (n === 1 ? "Grabby Pants once" : `Grabby Pants ${n} times`),
  },
  {
    id: "marva",
    title: "Marva's favourite",
    counts: "marvaRules",
    what: (n) => (n === 1 ? "one Marva Rule" : `${n} Marva Rules`),
  },
  {
    id: "clean",
    title: "Cleanest books",
    counts: "cleanBooks",
    what: (n) => (n === 1 ? "one clean book" : `${n} clean books`),
  },
  {
    id: "out",
    title: "First out the door",
    counts: "wentOut",
    what: (n) => (n === 1 ? "went out once" : `went out ${n} times`),
  },
  {
    id: "pile",
    title: "Pile collector",
    counts: "pilesTaken",
    what: (n) => (n === 1 ? "took the pile once" : `took the pile ${n} times`),
  },
  {
    id: "red-threes",
    title: "Ate the most red threes",
    counts: "redThreesEaten",
    what: (n) => (n === 1 ? "one red three" : `${n} red threes`),
  },
];

/** The awards for a match's tallies, leaving out any nobody earned and any seats `skip` names. */
export function awards(
  tallies: readonly SeatTally[],
  skip: (seat: number) => boolean = () => false,
): Award[] {
  return AWARDS.flatMap((award) => {
    const counts = tallies.map((t, seat) => (skip(seat) ? 0 : (t[award.counts] ?? 0)));
    const best = Math.max(0, ...counts);
    if (best === 0) return [];
    const seats = counts.flatMap((n, seat) => (n === best ? [seat] : []));
    return [{ id: award.id, title: award.title, seats, count: best, what: award.what(best) }];
  });
}
