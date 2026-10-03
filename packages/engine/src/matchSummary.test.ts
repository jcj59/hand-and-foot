import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type GameState, type RulesConfig } from "@hf/shared";
import { heuristicPolicy } from "./arena";
import { deal } from "./deal";
import { grabbyHistory } from "./grabby";
import { gotDownByMarva } from "./marva";
import { summarizeMatch } from "./matchSummary";
import { isMatchOver, matchTotals } from "./nextRound";
import { applyAction } from "./reducer";
import { scoreRound } from "./scoreRound";

interface Played {
  readonly actions: Action[];
  /** The state before each action, so a test can recount what happened independently. */
  readonly states: GameState[];
  readonly end: GameState;
}

/**
 * A whole match of heuristic players, every action recorded, with an optional
 * player leaving after a given round.
 */
function play(
  seed: number,
  players: number,
  config: RulesConfig = EAST_COAST,
  leave?: { readonly seat: number; readonly afterRound: number },
  stopAfter = Infinity,
): Played {
  let state = deal(players, config, seed);
  const actions: Action[] = [];
  const states: GameState[] = [];
  const apply = (action: Action): void => {
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(r.error);
    states.push(state);
    actions.push(action);
    state = r.state;
  };
  for (let guard = 0; actions.length < stopAfter; guard++) {
    if (guard > 50_000) throw new Error("the match did not end");
    if (state.roundEnded) {
      if (isMatchOver(state)) break;
      if (leave?.afterRound === state.roundNumber)
        apply({ type: "removePlayer", seat: leave.seat });
      apply({ type: "nextRound" });
      continue;
    }
    apply(heuristicPolicy(state, state.currentSeat)!);
  }
  return { actions, states, end: state };
}

function summary(seed: number, players: number, played: Played, config = EAST_COAST) {
  return summarizeMatch({
    config,
    seed,
    playerCount: players,
    firstSeat: 0,
    actions: played.actions,
  });
}

describe("summarizing a match", () => {
  const SEED = 4;
  const played = play(SEED, 3);
  const s = summary(SEED, 3, played);

  it("has every round's scores, the totals, and that it was played to the end", () => {
    const { end } = played;
    expect(s.finished).toBe(true);
    expect(s.roundsPlayed).toBe(4);
    expect(s.rounds).toEqual(
      [...end.pastRounds!, scoreRound(end)].map((round) => round.map((r) => r.score)),
    );
    expect(s.totals).toEqual(matchTotals(end));
    expect(s.departed).toEqual([]);
  });

  it("names the seat with the best total as the winner", () => {
    const best = Math.max(...s.totals);
    expect(s.winners).toEqual(s.totals.flatMap((t, seat) => (t === best ? [seat] : [])));
    expect(s.winners.length).toBeGreaterThan(0);
  });

  it("counts each seat's piles, go-outs and books", () => {
    for (let seat = 0; seat < 3; seat++) {
      const piles = played.actions.filter(
        (a, i) => a.type === "takePile" && played.states[i]!.currentSeat === seat,
      ).length;
      const roundEnds = played.states
        .map((_, i) => (i + 1 < played.states.length ? played.states[i + 1]! : played.end))
        .filter((st, i) => st.roundEnded && !played.states[i]!.roundEnded);
      const wentOut = roundEnds.filter((st) => st.wentOutSeat === seat).length;
      const rounds = [...played.end.pastRounds!, scoreRound(played.end)];
      expect(s.tallies[seat]).toMatchObject({
        pilesTaken: piles,
        wentOut,
        cleanBooks: rounds.reduce((n, r) => n + r[seat]!.breakdown.cleanBooks, 0),
        dirtyBooks: rounds.reduce((n, r) => n + r[seat]!.breakdown.dirtyBooks, 0),
        redThreesEaten: rounds.reduce((n, r) => n + r[seat]!.breakdown.redThreesHeld, 0),
      });
    }
    expect(s.tallies.reduce((n, t) => n + t.wentOut, 0)).toBeGreaterThan(0);
  });

  it("counts Grabby Pants each time it is earned, and each Marva Rule", () => {
    const entries = played.actions.map((action, i) => ({
      seat: played.states[i]!.currentSeat,
      action,
    }));
    const holders = grabbyHistory(entries);
    for (let seat = 0; seat < 3; seat++) {
      const earned = holders.filter(
        (h, k) => h?.seat === seat && (k === 0 || holders[k - 1]?.seat !== seat),
      ).length;
      const marva = played.actions.filter((a, i) => {
        const after = i + 1 < played.states.length ? played.states[i + 1]! : played.end;
        return (
          a.type === "playMelds" &&
          played.states[i]!.currentSeat === seat &&
          gotDownByMarva(played.states[i]!, after, seat)
        );
      }).length;
      expect(s.tallies[seat]!.grabbyPants).toBe(earned);
      expect(s.tallies[seat]!.marvaRules).toBe(marva);
    }
  });

  it("finds some Grabby Pants and Marva Rules over enough matches to be worth counting", () => {
    let grabby = 0;
    let marva = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = summary(seed, 4, play(seed, 4), EAST_COAST);
      grabby += m.tallies.reduce((n, t) => n + t.grabbyPants, 0);
      marva += m.tallies.reduce((n, t) => n + t.marvaRules, 0);
    }
    expect(grabby).toBeGreaterThan(0);
    expect(marva).toBeGreaterThan(0);
  });
});

describe("a match that did not start at seat 0", () => {
  it("is replayed from the seat that started it", () => {
    let state = deal(3, EAST_COAST, 9, 1, 2);
    const actions: Action[] = [];
    while (!state.roundEnded) {
      const action = heuristicPolicy(state, state.currentSeat)!;
      actions.push(action);
      state = (applyAction(state, action) as { state: GameState }).state;
    }
    const s = summarizeMatch({
      config: EAST_COAST,
      seed: 9,
      playerCount: 3,
      firstSeat: 2,
      actions,
    });
    expect(s.totals).toEqual(matchTotals(state));
  });
});

describe("a match that stopped part way", () => {
  it("counts only the rounds played to their end, and names no winner", () => {
    const whole = play(4, 3);
    // Stop in the middle of the third round.
    const third = whole.states.findIndex((st) => st.roundNumber === 3) + 5;
    const part = play(4, 3, EAST_COAST, undefined, third);
    const s = summary(4, 3, part);
    expect(s.finished).toBe(false);
    expect(s.roundsPlayed).toBe(2);
    expect(s.rounds).toHaveLength(2);
    expect(s.winners).toEqual([]);
    expect(s.totals).toEqual(matchTotals(part.end));
  });
});

describe("a match someone left", () => {
  it("records the departure, and never names the leaver the winner", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const played = play(seed, 3, EAST_COAST, { seat: 1, afterRound: 1 });
      const s = summary(seed, 3, played);
      expect(s.departed).toEqual([{ seat: 1, afterRound: 1 }]);
      expect(s.finished).toBe(true);
      expect(s.winners).not.toContain(1);
      const best = Math.max(s.totals[0]!, s.totals[2]!);
      expect(s.winners).toEqual([0, 2].filter((seat) => s.totals[seat] === best));
      // Rounds after leaving score nothing for the leaver.
      expect(s.rounds.slice(1).every((round) => round[1] === 0)).toBe(true);
    }
  });

  it("does not hand the win to a leaver who led the table", () => {
    // Find a match where the leaver's one round outscores what either finisher totals.
    let found = false;
    for (let seed = 1; seed <= 60 && !found; seed++) {
      const played = play(
        seed,
        3,
        { ...EAST_COAST, rounds: 2, layDownMinimums: [60, 90] },
        {
          seat: 1,
          afterRound: 1,
        },
      );
      const s = summarizeMatch({
        config: { ...EAST_COAST, rounds: 2, layDownMinimums: [60, 90] },
        seed,
        playerCount: 3,
        firstSeat: 0,
        actions: played.actions,
      });
      if (s.totals[1]! > Math.max(s.totals[0]!, s.totals[2]!)) {
        found = true;
        expect(s.winners).not.toContain(1);
        expect(s.winners.length).toBeGreaterThan(0);
      }
    }
    expect(found).toBe(true);
  });
});
