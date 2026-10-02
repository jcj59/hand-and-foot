import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Action,
  type Card,
  type GameState,
  type Meld,
  type PlayerState,
  type Rank,
  type RulesConfig,
} from "@hf/shared";
import { deal } from "./deal";
import { buildShoe } from "./deck";
import { matchTotals } from "./nextRound";
import { defaultAction } from "./policy";
import { applyAction } from "./reducer";
import { replay } from "./replay";
import { scoreRound } from "./scoreRound";
import { isSeated, nextSeated, seatedCount } from "./seats";

/** Short rounds: no extra decks, and a round ends when the stock does. */
const SHORT: RulesConfig = { ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" };

/** Play the safe default until the round ends, recording every action and every seat on turn. */
function finishRound(state: GameState, log: Action[] = [], turns: number[] = []): GameState {
  let s = state;
  for (let guard = 0; !s.roundEnded; guard++) {
    expect(guard).toBeLessThan(3_000);
    turns.push(s.currentSeat);
    const action = defaultAction(s)!;
    const r = applyAction(s, action);
    if (!r.ok) throw new Error(r.error);
    log.push(action);
    s = r.state;
  }
  return s;
}

function apply(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const remove = (seat: number): Action => ({ type: "removePlayer", seat });

function allCards(state: GameState): Card[] {
  return [
    ...state.stock,
    ...state.discard,
    ...state.players.flatMap((p) => [...p.hand, ...p.foot, ...p.melds.flatMap((m) => m.cards)]),
  ];
}

describe("removing a player between rounds", () => {
  it("is refused while the round is being played, leaving the state as it was", () => {
    const s = deal(3, SHORT, 5);
    const before = JSON.stringify(s);
    expect(applyAction(s, remove(1))).toEqual({
      ok: false,
      error: "a player can only leave between rounds",
    });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("is refused once the match is over", () => {
    let s = deal(3, { ...SHORT, rounds: 1 }, 5);
    s = finishRound(s);
    expect(applyAction(s, remove(1))).toEqual({ ok: false, error: "the match is over" });
  });

  it("is refused at a competitive table", () => {
    const s = finishRound(deal(3, { ...SHORT, mode: "competitive", pauseEnabled: false }, 5));
    expect(applyAction(s, remove(1))).toEqual({
      ok: false,
      error: "only a family game can carry on without a player",
    });
  });

  it("is refused for a seat that is not at the table", () => {
    const s = finishRound(deal(3, SHORT, 5));
    for (const seat of [-1, 3, 1.5, Number.NaN]) {
      expect(applyAction(s, remove(seat))).toEqual({ ok: false, error: "there is no such player" });
    }
  });

  it("is refused for a player who has already left", () => {
    const s = apply(finishRound(deal(4, SHORT, 5)), remove(2));
    expect(applyAction(s, remove(2))).toEqual({ ok: false, error: "that player has already left" });
  });

  it("is refused when it would leave fewer than two players", () => {
    const two = finishRound(deal(2, SHORT, 5));
    expect(applyAction(two, remove(0))).toEqual({
      ok: false,
      error: "a game needs at least 2 players",
    });
    // Three can lose one, but the two left cannot lose another.
    const three = apply(finishRound(deal(3, SHORT, 5)), remove(0));
    expect(applyAction(three, remove(1))).toEqual({
      ok: false,
      error: "a game needs at least 2 players",
    });
  });

  it("records the departure and changes nothing else about the finished round", () => {
    const ended = finishRound(deal(3, SHORT, 5));
    const after = apply(ended, remove(1));
    expect(after).toStrictEqual({ ...ended, departed: [{ seat: 1, afterRound: 1 }] });
    // Still between rounds: nothing but the table's actions is accepted.
    expect(applyAction(after, { type: "draw" }).ok).toBe(false);
  });

  it("scores the leaver for the round they played, and deals them nothing after", () => {
    const ended = finishRound(deal(3, SHORT, 5));
    const two = apply(apply(ended, remove(1)), { type: "nextRound" });
    // The finished round is scored as it was played, the leaver included.
    expect(two.pastRounds).toEqual([scoreRound(ended)]);
    expect(two.players).toHaveLength(3);
    expect(two.players[1]).toEqual({
      hand: [],
      foot: [],
      melds: [],
      isDown: false,
      inFoot: false,
      footPending: false,
    });
    for (const seat of [0, 2]) {
      expect(two.players[seat]!.hand).toHaveLength(SHORT.handSize);
      expect(two.players[seat]!.foot).toHaveLength(SHORT.footSize);
    }
    // A shoe for the two still playing, as a two-player table would have.
    expect(allCards(two)).toHaveLength(buildShoe(2, SHORT.extraDecks).length);
    expect(two.departed).toEqual([{ seat: 1, afterRound: 1 }]);
  });

  it("deals the smaller table exactly as a table that size would be dealt", () => {
    const ended = finishRound(deal(3, SHORT, 5));
    const two = apply(apply(ended, remove(1)), { type: "nextRound" });
    const fresh = deal(2, SHORT, 5, 2);
    expect(two.players[0]!.hand).toEqual(fresh.players[0]!.hand);
    expect(two.players[2]!.hand).toEqual(fresh.players[1]!.hand);
    expect(two.stock).toEqual(fresh.stock);
    expect(two.discard).toEqual(fresh.discard);
  });

  it("never gives the departed seat a turn", () => {
    const ended = finishRound(deal(4, SHORT, 7));
    const turns: number[] = [];
    finishRound(apply(apply(ended, remove(2)), { type: "nextRound" }), [], turns);
    expect(turns.length).toBeGreaterThan(20);
    expect(turns).not.toContain(2);
    expect(new Set(turns)).toEqual(new Set([0, 1, 3]));
  });

  it("passes the first turn on from whoever started the last round, skipping the leaver", () => {
    // Four players, seat 0 first: rounds 1 and 2 start at 0 and 1. Seat 2 leaves
    // after round 2, so round 3 starts at 3 — the next player on from seat 1 — and
    // round 4 at 0. Counting rounds from seat 0 instead would give seat 3 both.
    let s = finishRound(deal(4, SHORT, 3));
    const firsts = [0];
    s = apply(s, { type: "nextRound" });
    firsts.push(s.currentSeat);
    s = apply(finishRound(s), remove(2));
    for (let round = 3; round <= 4; round++) {
      s = apply(round === 3 ? s : finishRound(s), { type: "nextRound" });
      firsts.push(s.currentSeat);
    }
    expect(firsts).toEqual([0, 1, 3, 0]);
  });

  it("passes the first turn on from a starter who then left", () => {
    // Seat 1 starts round 2 and leaves after it: round 3 goes to seat 2, the next
    // player on from seat 1 — not to seat 3, as if seat 1 had never started round 2.
    let s = apply(finishRound(deal(4, SHORT, 3)), { type: "nextRound" });
    expect(s.currentSeat).toBe(1);
    s = apply(apply(finishRound(s), remove(1)), { type: "nextRound" });
    expect(s.currentSeat).toBe(2);
  });

  it("skips the leaver from a random first seat too", () => {
    // Seat 1 starts round 1 and leaves after it: round 2 goes to seat 2.
    const s = apply(apply(finishRound(deal(3, SHORT, 9, 1, 1)), remove(1)), {
      type: "nextRound",
    });
    expect(s.currentSeat).toBe(2);
    expect(s.firstSeat).toBe(1);
  });

  it("skips the leaver even when the round's first turn would have been theirs", () => {
    // Seat 1 would start round 2; having left, the turn goes on to seat 2.
    const s = apply(apply(finishRound(deal(3, SHORT, 9)), remove(1)), { type: "nextRound" });
    expect(s.currentSeat).toBe(2);
  });

  it("keeps the leaver's total, from the rounds they played", () => {
    const one = finishRound(deal(3, SHORT, 5));
    let s = apply(apply(one, remove(0)), { type: "nextRound" });
    s = finishRound(s);
    const totals = matchTotals(s);
    expect(totals[0]).toBe(scoreRound(one)[0]!.score);
    // Sitting the round out scores nothing.
    expect(scoreRound(s)[0]!.score).toBe(0);
    expect(totals[1]).toBe(scoreRound(one)[1]!.score + scoreRound(s)[1]!.score);
  });

  it("lets more than one player leave, one at a time", () => {
    let s = apply(apply(finishRound(deal(5, SHORT, 2)), remove(4)), remove(0));
    expect(s.departed).toEqual([
      { seat: 4, afterRound: 1 },
      { seat: 0, afterRound: 1 },
    ]);
    s = apply(s, { type: "nextRound" });
    expect(seatedCount(s)).toBe(3);
    expect(allCards(s)).toHaveLength(buildShoe(3, SHORT.extraDecks).length);
    // A third can go after the next round, down to two.
    s = apply(finishRound(s), remove(2));
    s = apply(s, { type: "nextRound" });
    expect(s.departed).toEqual([
      { seat: 4, afterRound: 1 },
      { seat: 0, afterRound: 1 },
      { seat: 2, afterRound: 2 },
    ]);
    expect(allCards(s)).toHaveLength(buildShoe(2, SHORT.extraDecks).length);
    expect(s.players.filter((p) => p.hand.length > 0)).toHaveLength(2);
  });

  it("replays from the log, departure and all", () => {
    const log: Action[] = [];
    let s = finishRound(deal(3, SHORT, 5), log);
    for (const action of [remove(1), { type: "nextRound" } as const]) {
      s = apply(s, action);
      log.push(action);
    }
    s = finishRound(s, log);
    expect(replay(5, 3, SHORT, log)).toEqual(s);
  });
});

describe("the final lap after someone has left", () => {
  const cardsOf = (rank: Rank, n: number, tag: string): Card[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${tag}${rank}${i}`, rank, suit: "clubs" }));
  const book = (rank: Rank): Meld => ({ rank, cards: cardsOf(rank, 7, "b") });
  const player = (over: Partial<PlayerState>): PlayerState => ({
    hand: [],
    foot: [],
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
    ...over,
  });

  it("gives one more turn to each player still in the match, and none to the leaver", () => {
    const tens = cardsOf("10", 3, "t");
    const books = [
      book("K"),
      { rank: "Q" as Rank, cards: [...cardsOf("Q", 6, "q"), ...cardsOf("2", 1, "w")] },
      { rank: "J" as Rank, cards: [...cardsOf("J", 6, "j"), ...cardsOf("2", 1, "x")] },
    ];
    const s: GameState = {
      config: EAST_COAST,
      seed: 0,
      roundNumber: 2,
      players: [
        player({ isDown: true, inFoot: true, foot: tens, melds: books }),
        // The seat to the winner's left has gone, so the lap starts past it.
        player({}),
        player({ hand: cardsOf("6", 2, "a") }),
        player({ hand: cardsOf("6", 2, "c") }),
      ],
      currentSeat: 0,
      phase: "play",
      stock: cardsOf("9", 10, "s"),
      discard: cardsOf("8", 1, "d"),
      departed: [{ seat: 1, afterRound: 1 }],
    };
    let state = apply(s, {
      type: "playMelds",
      melds: [{ rank: "10", cardIds: tens.map((c) => c.id) }],
    });
    expect(state.wentOutSeat).toBe(0);
    expect(state.finalLapRemaining).toBe(2);
    for (const seat of [2, 3]) {
      expect(state.currentSeat).toBe(seat);
      expect(state.roundEnded ?? false).toBe(false);
      state = apply(state, { type: "draw" });
      state = apply(state, { type: "discard", cardId: state.players[seat]!.hand[0]!.id });
    }
    expect(state.roundEnded).toBe(true);
  });
});

describe("seats", () => {
  it("walks round the table past anyone who has left", () => {
    const s: GameState = {
      ...deal(5, SHORT, 1),
      departed: [
        { seat: 1, afterRound: 1 },
        { seat: 2, afterRound: 1 },
        { seat: 4, afterRound: 1 },
      ],
    };
    expect(isSeated(s, 0)).toBe(true);
    expect(isSeated(s, 2)).toBe(false);
    expect(seatedCount(s)).toBe(2);
    expect(nextSeated(s, 0)).toBe(3);
    expect(nextSeated(s, 3)).toBe(0);
  });
});
