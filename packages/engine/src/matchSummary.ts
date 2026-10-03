import type { Action, MatchSummary, RoundScore, RulesConfig, SeatTally } from "@hf/shared";
import { matchTotals, isMatchOver } from "./nextRound";
import { buildTimeline, type Timeline } from "./playback";
import { scoreRound } from "./scoreRound";
import { isSeated } from "./seats";

/** A match as it was dealt and played: enough to replay it. */
export interface PlayedMatch {
  readonly config: RulesConfig;
  readonly seed: number;
  readonly playerCount: number;
  readonly firstSeat: number;
  readonly actions: readonly Action[];
}

/**
 * Sum up a match from its log: the scores of every round played to its end, the
 * totals and who won, and what each seat did that a player's stats count.
 *
 * Worked out by replaying the log through the same timeline the replay player
 * uses, so a stat can never disagree with what watching the match back shows —
 * the Grabby Pants earned are exactly the timeline's `grabbyPants` moments, the
 * Marva Rules its `marva` moments. Throws, as the timeline does, if the log does
 * not replay.
 */
export function summarizeMatch(match: PlayedMatch): MatchSummary {
  const timeline = buildTimeline({
    config: match.config,
    setup: { seed: match.seed, playerCount: match.playerCount, firstSeat: match.firstSeat },
    actions: match.actions,
  });
  const end = timeline.stateAt(timeline.length);
  const rounds = [...(end.pastRounds ?? []), ...(end.roundEnded ? [scoreRound(end)] : [])];
  const totals = matchTotals(end);
  const finished = isMatchOver(end);
  // The win is among the players who finished the match, whoever led before leaving.
  const finishers = totals.flatMap((total, seat) => (isSeated(end, seat) ? [{ seat, total }] : []));
  const best = Math.max(...finishers.map((f) => f.total));
  const winners = finished ? finishers.filter((f) => f.total === best).map((f) => f.seat) : [];

  return {
    roundsPlayed: rounds.length,
    rounds: rounds.map((round) => round.map((r) => r.score)),
    totals,
    finished,
    winners,
    departed: end.departed ?? [],
    tallies: seatTallies(timeline, rounds),
  };
}

/**
 * What each seat did over a game, for stats and awards: counted from the timeline's
 * own moments, and from the scores of the rounds played to their end (the whole
 * game's unless given), so a count can never disagree with what the replay shows.
 */
export function seatTallies(
  timeline: Timeline,
  rounds: readonly (readonly RoundScore[])[] = finishedRounds(timeline),
): SeatTally[] {
  return Array.from({ length: timeline.playerCount }, (_, seat) => {
    const at = (kind: string): number =>
      timeline.moments.filter((m) => m.kind === kind && m.seat === seat).length;
    const sum = (part: "cleanBooks" | "dirtyBooks" | "redThreesHeld"): number =>
      rounds.reduce((n, round) => n + round[seat]!.breakdown[part], 0);
    return {
      pilesTaken: at("pileTaken"),
      grabbyPants: at("grabbyPants"),
      marvaRules: at("marva"),
      wentOut: at("wentOut"),
      cleanBooks: sum("cleanBooks"),
      dirtyBooks: sum("dirtyBooks"),
      redThreesEaten: sum("redThreesHeld"),
    };
  });
}

function finishedRounds(timeline: Timeline): (readonly RoundScore[])[] {
  const end = timeline.stateAt(timeline.length);
  return [...(end.pastRounds ?? []), ...(end.roundEnded ? [scoreRound(end)] : [])];
}
