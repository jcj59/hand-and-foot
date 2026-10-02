import type { Action, MatchSummary, RulesConfig, SeatTally } from "@hf/shared";
import { matchTotals, isMatchOver } from "./nextRound";
import { buildTimeline } from "./playback";
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

  const tallies: SeatTally[] = end.players.map((_, seat) => {
    const at = (kind: string): number =>
      timeline.moments.filter((m) => m.kind === kind && m.seat === seat).length;
    return {
      pilesTaken: at("pileTaken"),
      grabbyPants: at("grabbyPants"),
      marvaRules: at("marva"),
      wentOut: at("wentOut"),
      cleanBooks: rounds.reduce((n, round) => n + round[seat]!.breakdown.cleanBooks, 0),
      dirtyBooks: rounds.reduce((n, round) => n + round[seat]!.breakdown.dirtyBooks, 0),
    };
  });

  return {
    roundsPlayed: rounds.length,
    rounds: rounds.map((round) => round.map((r) => r.score)),
    totals,
    finished,
    winners,
    departed: end.departed ?? [],
    tallies,
  };
}
