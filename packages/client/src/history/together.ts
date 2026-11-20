/**
 * One person the player has played with, as their own history tells it: how many
 * games they shared, who won them, and how each of them scored. Built only from the
 * recent games the server already sent, never a request, so it is the player's view
 * of that person, not that person's record: a listing names people and nothing
 * more, so anyone who played under that name counts, and the words say "your games
 * together" rather than claim more. Computers are never a person here. Pure, so
 * every number and word is pinned by a test.
 */
import type { Avatar, MatchListing } from "@hf/shared";
import { day, mine, points } from "./describe";
import { people } from "./filters";

export interface Together {
  readonly name: string;
  /** The picture they had at the latest game together. */
  readonly avatar?: Avatar;
  /** Games together, finished or not. */
  readonly games: number;
  /** When the latest of them ended. */
  readonly lastPlayed: number;
  readonly them: Side;
  readonly you: Side;
}

/** How one of the two did in the games together that they played to the end. */
export interface Side {
  readonly wins: number;
  /** Mean final total; null before the first game played to the end. */
  readonly average: number | null;
  /** The best final total; null before the first game played to the end. */
  readonly best: number | null;
}

type Player = MatchListing["players"][number];

/**
 * What the player's games with `name` say, or null when there are none. A game
 * counts toward a side's wins, average and best only when it was played to the
 * end and that side did not leave it; a win is the top total among those who
 * stayed, ties included, as at the table.
 */
export function together(recent: readonly MatchListing[], name: string): Together | null {
  const shared = recent.flatMap((match) => {
    const them = people(match).find((p) => p.name === name);
    return them ? [{ match, them }] : [];
  });
  if (shared.length === 0) return null;
  const latest = shared.reduce((a, b) => (b.match.endedAt > a.match.endedAt ? b : a));
  const avatar = latest.them.avatar;
  return {
    name,
    ...(avatar ? { avatar } : {}),
    games: shared.length,
    lastPlayed: latest.match.endedAt,
    them: side(shared.map(({ match, them }) => ({ match, player: them }))),
    you: side(shared.map(({ match }) => ({ match, player: mine(match) }))),
  };
}

function side(games: readonly { match: MatchListing; player: Player }[]): Side {
  const played = games.filter(({ match, player }) => match.finished && !player.left);
  const totals = played.map(({ player }) => player.total);
  return {
    wins: played.filter(({ match, player }) => player.total === top(match)).length,
    average:
      totals.length === 0
        ? null
        : Math.round(totals.reduce((sum, t) => sum + t, 0) / totals.length),
    best: totals.length === 0 ? null : Math.max(...totals),
  };
}

/** The winning total: the highest among the players who did not leave. */
function top(match: MatchListing): number {
  return Math.max(...match.players.filter((p) => !p.left).map((p) => p.total));
}

/** The first word of a name, for the label under a face: "Aunt May" is "Aunt". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "1 game", "12 games". */
export function gamesCount(n: number): string {
  return `${n} game${n === 1 ? "" : "s"}`;
}

/** When the latest game together ended: "Last played Nov 7". */
export function lastPlayedLine(t: Together): string {
  return `Last played ${day(t.lastPlayed)}`;
}

/** A total, or a dash before there is one. */
export function stat(value: number | null): string {
  return value === null ? "–" : points(value);
}
