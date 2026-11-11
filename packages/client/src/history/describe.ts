/**
 * How one past game reads on the History page: its result, the words on its card,
 * and its final scores. Pure, so every wording is pinned by a test and none of it
 * hides in markup.
 */
import { AWARDS, type MatchListing } from "@hf/shared";
import { PRESET_NAMES } from "../rules/ruleText";

/** A game's result for the player, which colors its card and the Place filter picks by. */
export type Result = "won" | "second" | "third" | "unfinished";

type Player = MatchListing["players"][number];

/** The player's own seat in the game. */
export function mine(match: MatchListing): Player {
  return match.players.find((p) => p.seat === match.seat)!;
}

/**
 * Won, second, third or lower, or unfinished. A game has a place only once it was
 * played to the end by the player, so one they left counts as unfinished for them,
 * whatever the others went on to do.
 */
export function resultOf(match: MatchListing): Result {
  if (match.place === null) return "unfinished";
  if (match.won) return "won";
  return match.place === 2 ? "second" : "third";
}

/**
 * A practice game: everyone else at the table was a computer. Told from the seats
 * rather than stored, so games played against computers before Practice existed
 * are tagged the same way.
 */
export function isPractice(match: MatchListing): boolean {
  const others = match.players.filter((p) => p.seat !== match.seat);
  return others.length > 0 && others.every((p) => p.bot);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The card's heading: "You won", "2nd of 3", "Unfinished", "You left". */
export function titleOf(match: MatchListing): string {
  if (mine(match).left) return "You left";
  const result = resultOf(match);
  if (result === "unfinished") return "Unfinished";
  if (result === "won") return "You won";
  const finishers = match.players.filter((p) => !p.left).length;
  return `${ordinal(match.place!)} of ${finishers}`;
}

/** The square beside the heading: the place, or how far an unfinished game got. */
export function badgeOf(match: MatchListing): string {
  if (mine(match).left) return "Left";
  if (resultOf(match) === "unfinished") return `${match.roundsPlayed}/${match.rounds}`;
  return ordinal(match.place!);
}

/** A whole number with thousands separators, as every score on the page is written. */
export function points(n: number): string {
  return n.toLocaleString("en-US");
}

/** "Nov 7", in the device's time zone. */
export function day(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The line under the heading: when, how long, and under which rules, as
 * "Nov 7 · 4 rounds · East Coast". A practice game says so instead of its variant,
 * and an unfinished one says where it stopped.
 */
export function metaOf(match: MatchListing): string {
  const parts = [day(match.endedAt)];
  if (isPractice(match)) parts.push("practice");
  if (!match.finished) {
    parts.push(
      match.roundsPlayed === 0 ? "stopped in round 1" : `stopped after round ${match.roundsPlayed}`,
    );
  } else {
    parts.push(plural(match.rounds, "round"));
    if (!isPractice(match)) parts.push(PRESET_NAMES[match.preset]);
  }
  return parts.join(" · ");
}

/** The titles of the awards the player took home from the game, in their order. */
export function awardsOf(match: MatchListing): string[] {
  return match.awards.flatMap((id) => AWARDS.find((a) => a.id === id)?.title ?? []);
}

export interface ScoreRow {
  readonly player: Player;
  readonly you: boolean;
  /** How full the row's bar is, 0 to 1, against the top score. */
  readonly share: number;
}

/** The final scores, highest first, each with its bar measured against the top one. */
export function scoreRows(match: MatchListing): ScoreRow[] {
  const sorted = [...match.players].sort((a, b) => b.total - a.total);
  const top = sorted[0]?.total ?? 0;
  return sorted.map((player) => ({
    player,
    you: player.seat === match.seat,
    share: top > 0 ? Math.max(0, player.total) / top : 0,
  }));
}
