import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type GameState, type RulesConfig } from "@hf/shared";
import { deal, firstSeatFor, roundSeed } from "./deal";
import { isMatchOver, matchTotals } from "./nextRound";
import { defaultAction } from "./policy";
import { applyAction } from "./reducer";
import { replay } from "./replay";
import { prng } from "./rng";
import { scoreRound } from "./scoreRound";

/** Short rounds: no extra decks, and a round ends when the stock does. */
const SHORT: RulesConfig = { ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" };

/** Play the safe default until the round ends, recording every action. */
function finishRound(state: GameState, log: Action[] = []): GameState {
  let s = state;
  for (let guard = 0; !s.roundEnded; guard++) {
    expect(guard).toBeLessThan(2_000);
    const action = defaultAction(s)!;
    const r = applyAction(s, action);
    expect(r.ok).toBe(true);
    if (!r.ok) return s;
    log.push(action);
    s = r.state;
  }
  return s;
}

function next(state: GameState): GameState {
  const r = applyAction(state, { type: "nextRound" });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("the rounds of a match", () => {
  it("plays four rounds with escalating minimums", () => {
    expect(EAST_COAST.rounds).toBe(4);
    expect(EAST_COAST.layDownMinimums).toEqual([60, 90, 120, 150]);
  });

  it("deals the next round only once this one has ended", () => {
    const s = deal(2, SHORT, 5);
    expect(applyAction(s, { type: "nextRound" })).toEqual({
      ok: false,
      error: "the round is still being played",
    });
  });

  it("deals round two: a fresh shoe, empty melds, and the finished scores kept", () => {
    const ended = finishRound(deal(3, SHORT, 5));
    const two = next(ended);
    expect(two.roundNumber).toBe(2);
    expect(two.roundEnded ?? false).toBe(false);
    expect(two.phase).toBe("draw");
    expect(two.players.every((p) => p.melds.length === 0 && !p.isDown && !p.inFoot)).toBe(true);
    expect(two.pastRounds).toEqual([scoreRound(ended)]);
    // Its own shuffle, not round one's again.
    expect(two.players[0]!.hand).not.toEqual(deal(3, SHORT, 5).players[0]!.hand);
    expect(two.seed).toBe(5);
  });

  it("passes the first turn one seat to the left each round, wrapping round", () => {
    let s = deal(3, SHORT, 9);
    const firsts = [s.currentSeat];
    for (let round = 2; round <= 4; round++) {
      s = next(finishRound(s));
      firsts.push(s.currentSeat);
    }
    expect(firsts).toEqual([0, 1, 2, 0]);
  });

  it("holds each round to its own minimum", () => {
    const two = next(finishRound(deal(2, SHORT, 5)));
    expect(two.config.layDownMinimums[two.roundNumber - 1]).toBe(90);
  });

  it("ends the match after the last round, and deals no fifth", () => {
    let s = deal(2, SHORT, 11);
    for (let round = 1; round < 4; round++) s = next(finishRound(s));
    s = finishRound(s);
    expect(s.roundNumber).toBe(4);
    expect(isMatchOver(s)).toBe(true);
    expect(applyAction(s, { type: "nextRound" })).toEqual({
      ok: false,
      error: "that was the last round",
    });
  });

  it("is not over mid-match, nor while the last round is still being played", () => {
    const one = finishRound(deal(2, SHORT, 11));
    expect(isMatchOver(one)).toBe(false);
    const single = { ...SHORT, rounds: 1 };
    expect(isMatchOver(deal(2, single, 11))).toBe(false);
    expect(isMatchOver(finishRound(deal(2, single, 11)))).toBe(true);
  });

  it("adds every finished round into the running totals", () => {
    const one = finishRound(deal(2, SHORT, 13));
    const firstScores = scoreRound(one).map((r) => r.score);
    expect(matchTotals(one)).toEqual(firstScores);

    const two = next(one);
    // Mid-round, only the finished rounds count.
    expect(matchTotals(two)).toEqual(firstScores);
    const twoEnded = finishRound(two);
    const secondScores = scoreRound(twoEnded).map((r) => r.score);
    expect(matchTotals(twoEnded)).toEqual(firstScores.map((score, i) => score + secondScores[i]!));
  });

  it("replays a whole match from its seed and its actions", () => {
    const log: Action[] = [];
    let s = deal(2, SHORT, 17);
    for (let round = 1; round <= 4; round++) {
      s = finishRound(s, log);
      if (round < 4) {
        log.push({ type: "nextRound" });
        s = next(s);
      }
    }
    expect(replay(17, 2, SHORT, log)).toEqual(s);
  });
});

describe("who goes first", () => {
  it("starts round one at the seat given, and rotates from it each round after", () => {
    let s = deal(3, SHORT, 9, 1, 2);
    expect(s.firstSeat).toBe(2);
    const firsts = [s.currentSeat];
    for (let round = 2; round <= 4; round++) {
      s = next(finishRound(s));
      firsts.push(s.currentSeat);
      expect(s.firstSeat).toBe(2);
    }
    expect(firsts).toEqual([2, 0, 1, 2]);
  });

  it("deals the same cards whoever starts: only the turn moves", () => {
    const fromZero = deal(4, EAST_COAST, 31);
    const fromThree = deal(4, EAST_COAST, 31, 1, 3);
    expect({ ...fromThree, currentSeat: 0, firstSeat: undefined }).toEqual(fromZero);
  });

  it("leaves seat 0 unrecorded, so a match dealt the old way is the same value", () => {
    // Golden games and every stored log were dealt with no first seat at all.
    expect(deal(2, EAST_COAST, 5, 1, 0)).not.toHaveProperty("firstSeat");
    expect(deal(2, EAST_COAST, 5, 1, 0)).toEqual(deal(2, EAST_COAST, 5));
  });

  it("replays a match that started past seat 0 only when told the seat", () => {
    const log: Action[] = [];
    let s = deal(2, SHORT, 17, 1, 1);
    s = finishRound(s, log);
    log.push({ type: "nextRound" });
    s = finishRound(next(s), log);
    expect(replay(17, 2, SHORT, log, 1)).toEqual(s);
    // From seat 0 the first move is someone else's, so the log does not replay.
    expect(() => replay(17, 2, SHORT, log)).toThrow();
  });

  it("picks the first seat from the seed: the same every time, and any seat", () => {
    for (const players of [2, 3, 4, 5, 6]) {
      const counts = Array.from({ length: players }, () => 0);
      for (let seed = 0; seed < 3_000; seed++) {
        const seat = firstSeatFor(seed, players);
        expect(seat).toBe(firstSeatFor(seed, players));
        counts[seat]!++;
      }
      // Roughly even: no seat is favoured by more than a fifth of its share.
      const share = 3_000 / players;
      for (const n of counts) expect(Math.abs(n - share)).toBeLessThan(share / 5);
    }
  });

  it("does not simply reuse the shuffle's first draw", () => {
    // Were it the first number of `prng(seed)`, which the round-one shuffle also
    // starts from, the first seat would move with the first card swapped. Salted,
    // the two agree only as often as chance has them (a quarter of the time for
    // four seats).
    let same = 0;
    for (let seed = 0; seed < 1_000; seed++) {
      if (firstSeatFor(seed, 4) === Math.floor(prng(seed)() * 4)) same++;
    }
    expect(same).toBeGreaterThan(150);
    expect(same).toBeLessThan(350);
    // Pinned, so a change to the derivation is a decision rather than an accident.
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => firstSeatFor(seed, 4))).toEqual([
      0, 2, 3, 0, 0, 2, 3, 2,
    ]);
  });
});

describe("each round's shuffle", () => {
  it("leaves round one exactly as it always dealt", () => {
    // Every game recorded before rounds existed must still replay.
    expect(roundSeed(12345, 1)).toBe(12345);
    expect(deal(4, EAST_COAST, 12345, 1)).toEqual(deal(4, EAST_COAST, 12345));
  });

  it("gives later rounds a seed of their own, as an unsigned 32-bit number", () => {
    expect(roundSeed(12345, 2)).toBe(12345 + 1_000_003);
    expect(roundSeed(2 ** 32 - 1, 2)).toBe(1_000_002);
  });
});
