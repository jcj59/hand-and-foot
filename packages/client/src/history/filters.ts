/**
 * The History page's filters: by place, by when, by who else was at the table,
 * and the order the games come in. Pure, and run over the recent games the server
 * already sent, so filtering never asks the server again.
 */
import type { Avatar, MatchListing } from "@hf/shared";
import { mine, resultOf } from "./describe";

export type PlaceFilter = "all" | "won" | "second" | "third" | "unfinished";
export type WhenFilter = "all" | "month" | "3m";
export type SortOrder = "new" | "old" | "high" | "low";

export interface Filters {
  readonly place: PlaceFilter;
  readonly when: WhenFilter;
  readonly sort: SortOrder;
  /** The people every game shown must have been played with, by name. */
  readonly with: readonly string[];
}

export const NO_FILTERS: Filters = { place: "all", when: "all", sort: "new", with: [] };

export const PLACES: readonly { readonly value: PlaceFilter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "won", label: "Won" },
  { value: "second", label: "2nd" },
  { value: "third", label: "3rd or lower" },
  { value: "unfinished", label: "Unfinished" },
];

export const WHENS: readonly { readonly value: WhenFilter; readonly label: string }[] = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "3m", label: "Last 3 months" },
];

export const SORTS: readonly { readonly value: SortOrder; readonly label: string }[] = [
  { value: "new", label: "Newest first" },
  { value: "old", label: "Oldest first" },
  { value: "high", label: "Highest score" },
  { value: "low", label: "Lowest score" },
];

/**
 * The earliest end time `when` keeps, by the device's calendar: the first of this
 * month, or this day three months ago. Zero keeps everything.
 */
export function since(when: WhenFilter, now: number): number {
  if (when === "all") return 0;
  const today = new Date(now);
  if (when === "month") return new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  return new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).getTime();
}

/** The other people (never computers) at a game's table, by name. */
function people(match: MatchListing): MatchListing["players"] {
  return match.players.filter((p) => p.seat !== match.seat && !p.bot);
}

export interface Companion {
  readonly name: string;
  readonly avatar?: Avatar;
}

/**
 * Who the player has played with, most games together first (then by name), at
 * most `limit` of them, each with the picture they had at their latest game. A
 * person is told apart by name, the only thing a listing says about them.
 */
export function companions(recent: readonly MatchListing[], limit: number): Companion[] {
  const seen = new Map<string, { count: number; latest: number; avatar?: Avatar }>();
  for (const match of recent) {
    for (const p of people(match)) {
      const known = seen.get(p.name);
      if (!known) {
        seen.set(p.name, { count: 1, latest: match.endedAt, avatar: p.avatar });
        continue;
      }
      known.count++;
      if (match.endedAt > known.latest) {
        known.latest = match.endedAt;
        known.avatar = p.avatar;
      }
    }
  }
  return [...seen]
    .sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b))
    .slice(0, limit)
    .map(([name, { avatar }]) => (avatar ? { name, avatar } : { name }));
}

/** `with` with `name` added, or taken away if it was there. */
export function toggled(names: readonly string[], name: string): string[] {
  return names.includes(name) ? names.filter((n) => n !== name) : [...names, name];
}

/** The games the filters keep, in the order they ask for. */
export function filterGames(
  recent: readonly MatchListing[],
  filters: Filters,
  now: number,
): MatchListing[] {
  const from = since(filters.when, now);
  const kept = recent.filter(
    (match) =>
      (filters.place === "all" || resultOf(match) === filters.place) &&
      match.endedAt >= from &&
      filters.with.every((name) => people(match).some((p) => p.name === name)),
  );
  const newest = (a: MatchListing, b: MatchListing): number => b.endedAt - a.endedAt;
  const order: Record<SortOrder, (a: MatchListing, b: MatchListing) => number> = {
    new: newest,
    old: (a, b) => a.endedAt - b.endedAt,
    high: (a, b) => mine(b).total - mine(a).total || newest(a, b),
    low: (a, b) => mine(a).total - mine(b).total || newest(a, b),
  };
  return kept.sort(order[filters.sort]);
}

/** "6 games", "1 game with Kate", "2 games with Kate, Mom and Dad". */
export function summary(count: number, names: readonly string[]): string {
  const games = `${count} game${count === 1 ? "" : "s"}`;
  if (names.length === 0) return games;
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${games} with ${list}`;
}
