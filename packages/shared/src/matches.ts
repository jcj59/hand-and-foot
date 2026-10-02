// A finished (or abandoned) match as it is kept: what happened, who played it, and
// the log that replays it. And what a player is shown of the matches they were in:
// a list of recent ones and their stats.
//
// The record keeps the whole action log rather than a digest of it, because the log
// is a few kilobytes and everything else — the replay, any statistic thought of
// later — can be worked out from it again. The summary beside it is only what the
// home screen needs without replaying anything.

import type { Ack } from "./protocol";
import type { Avatar } from "./avatar";
import type { Action, Departure, RulesConfig } from "./index";
import type { ActionSource } from "./protocol";
import type { UserCredentials } from "./identity";

/** Who sat in one seat of a recorded match. */
export interface MatchSeat {
  readonly seat: number;
  readonly name: string;
  readonly avatar?: Avatar;
  /** The identity that sat here, when their browser proved one. Never sent to other players. */
  readonly userId?: string;
  /** A computer player: shown in the match, never given stats. */
  readonly bot?: true;
}

/** What one seat did over a match, counted from the log. */
export interface SeatTally {
  readonly pilesTaken: number;
  /** Times the seat earned Grabby Pants: from nobody, or from another player. */
  readonly grabbyPants: number;
  /** Lay-downs that got the seat down only through the Marva rule. */
  readonly marvaRules: number;
  readonly wentOut: number;
  readonly cleanBooks: number;
  readonly dirtyBooks: number;
}

/** A match's outcome, as the home screen needs it without replaying anything. */
export interface MatchSummary {
  /** Rounds that were played to their end. */
  readonly roundsPlayed: number;
  /** Each finished round's score by seat. */
  readonly rounds: readonly (readonly number[])[];
  /** Each seat's total over the finished rounds. */
  readonly totals: readonly number[];
  /** Whether the match was played to its last round. */
  readonly finished: boolean;
  /** The seats with the best total among those who finished it; empty when unfinished. */
  readonly winners: readonly number[];
  readonly departed: readonly Departure[];
  /** One per seat, in seat order. */
  readonly tallies: readonly SeatTally[];
}

/** One logged action, without the parts a replay does not need. */
export interface MatchMove {
  readonly seat: number;
  readonly action: Action;
  readonly source: ActionSource;
}

/** A match as it is kept: enough to show it in a list, and to replay it move by move. */
export interface MatchRecord {
  /** The table's storage identity: a match is recorded once, and again only to update it. */
  readonly id: string;
  /** The table code it was played at. Codes recur; `id` does not. */
  readonly roomId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly config: RulesConfig;
  readonly seed: number;
  readonly firstSeat: number;
  readonly seats: readonly MatchSeat[];
  readonly log: readonly MatchMove[];
  readonly summary: MatchSummary;
}

/** A recorded match as one of its players sees it in their list. */
export interface MatchListing {
  readonly id: string;
  readonly roomId: string;
  readonly endedAt: number;
  readonly rounds: number;
  readonly roundsPlayed: number;
  readonly finished: boolean;
  /** The player's own seat in it. */
  readonly seat: number;
  /** Where they came, from 1, among the players who finished; null if they left or it was unfinished. */
  readonly place: number | null;
  readonly won: boolean;
  readonly players: readonly {
    readonly seat: number;
    readonly name: string;
    readonly avatar?: Avatar;
    readonly bot?: true;
    readonly total: number;
    readonly left?: true;
  }[];
}

/** A player's record over every match kept for them. */
export interface PlayerStats {
  /** Matches played to the end. */
  readonly played: number;
  readonly wins: number;
  /** Matches that closed before their last round. */
  readonly unfinished: number;
  /** Mean final total over the matches played to the end; null before the first. */
  readonly averageScore: number | null;
  /** The best total in any match played to the end; null before the first. */
  readonly bestMatch: number | null;
  /** The best score in any one round, finished matches or not; null before any. */
  readonly bestRound: number | null;
  readonly roundsPlayed: number;
  readonly grabbyPants: number;
  readonly marvaRules: number;
  readonly wentOut: number;
  readonly cleanBooks: number;
  readonly dirtyBooks: number;
}

/** What the home screen asks for and gets: the player's stats and their latest matches. */
export interface MatchHistory {
  readonly stats: PlayerStats;
  readonly recent: readonly MatchListing[];
}

/** Ask for a player's match history: POST `{ user }` (their identity credentials). */
export const MATCHES_PATH = "/api/users/matches";

/** Ask for one of a player's matches, to watch it again: POST `{ user, id }`. */
export const MATCH_PATH = "/api/users/match";

/** Answered for a match id that is not one of the asking player's. */
export const NO_SUCH_MATCH = "that game is not one of yours";

/**
 * A match as one of its players is sent it to watch again: the record, with every
 * identity taken out, and the seat they sat in, which the replay follows first.
 */
export interface ReplayMatch extends Omit<MatchRecord, "seats"> {
  readonly seats: readonly Omit<MatchSeat, "userId">[];
  /** The asking player's own seat. */
  readonly seat: number;
}

/** The match for one of its players to watch, or null if they did not play in it. */
export function replayFor(record: MatchRecord, userId: string): ReplayMatch | null {
  const seat = seatOf(record, userId);
  if (seat === null) return null;
  return {
    ...record,
    seats: record.seats.map((s) => {
      const { userId, ...rest } = s;
      void userId;
      return rest;
    }),
    seat,
  };
}

/** How many matches the list shows; the stats count every match kept. */
export const RECENT_MATCHES = 20;

/** The seat a user sat in, if they were in the match at all (a computer never is). */
export function seatOf(record: MatchRecord, userId: string): number | null {
  return record.seats.find((s) => s.userId === userId && !s.bot)?.seat ?? null;
}

/** Whether a seat left the match before its end. */
function left(record: MatchRecord, seat: number): boolean {
  return record.summary.departed.some((d) => d.seat === seat);
}

/**
 * The match as one of its players sees it in a list: the names and totals at the
 * table, and how they did. Nobody's identity is in it, their own included — the
 * list needs none, and another player's id is not theirs to see.
 */
export function listingFor(record: MatchRecord, userId: string): MatchListing | null {
  const seat = seatOf(record, userId);
  if (seat === null) return null;
  const { summary } = record;
  const finishers = record.seats
    .map((s) => s.seat)
    .filter((s) => !left(record, s))
    .map((s) => summary.totals[s] ?? 0);
  const mine = summary.totals[seat] ?? 0;
  const place =
    summary.finished && !left(record, seat) ? 1 + finishers.filter((t) => t > mine).length : null;
  return {
    id: record.id,
    roomId: record.roomId,
    endedAt: record.endedAt,
    rounds: record.config.rounds,
    roundsPlayed: summary.roundsPlayed,
    finished: summary.finished,
    seat,
    place,
    won: summary.winners.includes(seat),
    players: record.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      ...(s.avatar ? { avatar: s.avatar } : {}),
      ...(s.bot ? { bot: true as const } : {}),
      total: summary.totals[s.seat] ?? 0,
      ...(left(record, s.seat) ? { left: true as const } : {}),
    })),
  };
}

/**
 * A player's stats over every match kept for them. Only their own seat counts; a
 * computer player has no identity and so is never anyone's stats, though a match
 * played against computers counts for the person who played it.
 */
export function statsFor(records: readonly MatchRecord[], userId: string): PlayerStats {
  let played = 0;
  let wins = 0;
  let unfinished = 0;
  let scoreSum = 0;
  let bestMatch: number | null = null;
  let bestRound: number | null = null;
  let roundsPlayed = 0;
  const counts = {
    grabbyPants: 0,
    marvaRules: 0,
    wentOut: 0,
    cleanBooks: 0,
    dirtyBooks: 0,
  };
  for (const record of records) {
    const seat = seatOf(record, userId);
    if (seat === null) continue;
    const { summary } = record;
    // A match the player left before its end is theirs to count only as far as
    // they played it: no win, no final total.
    if (summary.finished && !left(record, seat)) {
      played++;
      const total = summary.totals[seat] ?? 0;
      scoreSum += total;
      bestMatch = bestMatch === null ? total : Math.max(bestMatch, total);
      if (summary.winners.includes(seat)) wins++;
    } else if (!summary.finished) {
      unfinished++;
    }
    const playedTo = summary.departed.find((d) => d.seat === seat)?.afterRound ?? Infinity;
    summary.rounds.forEach((round, index) => {
      if (index + 1 > playedTo) return;
      roundsPlayed++;
      const score = round[seat] ?? 0;
      bestRound = bestRound === null ? score : Math.max(bestRound, score);
    });
    const tally = summary.tallies[seat];
    if (tally) {
      counts.grabbyPants += tally.grabbyPants;
      counts.marvaRules += tally.marvaRules;
      counts.wentOut += tally.wentOut;
      counts.cleanBooks += tally.cleanBooks;
      counts.dirtyBooks += tally.dirtyBooks;
    }
  }
  return {
    played,
    wins,
    unfinished,
    averageScore: played === 0 ? null : Math.round(scoreSum / played),
    bestMatch,
    bestRound,
    roundsPlayed,
    ...counts,
  };
}

/** The history a player is shown: stats over all their matches, and the latest listed newest first. */
export function historyFor(records: readonly MatchRecord[], userId: string): MatchHistory {
  const mine = records
    .filter((r) => seatOf(r, userId) !== null)
    .sort((a, b) => b.endedAt - a.endedAt);
  return {
    stats: statsFor(mine, userId),
    recent: mine.slice(0, RECENT_MATCHES).map((r) => listingFor(r, userId)!),
  };
}

/** The request for a player's history. */
export interface MatchesRequest {
  readonly user: UserCredentials;
}

export type MatchesResponse = Ack<MatchHistory>;
