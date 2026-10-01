import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  resolveRules,
  type Action,
  type Card,
  type GameState,
  type MeldPlay,
  type PlayerState,
  type Rank,
  type RulesConfig,
  type Suit,
} from "@hf/shared";
import { describeMove } from "./lastMove";
import { gotDownByMarva, layDownValue } from "./marva";
import { buildTimeline } from "./playback";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `mt${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number, suit: Suit = "clubs"): Card[] {
  return Array.from({ length: n }, () => card(rank, suit));
}
function player(over: Partial<PlayerState>): PlayerState {
  return {
    hand: [],
    foot: cards("9", 5),
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
    ...over,
  };
}
function table(p0: PlayerState, config: RulesConfig = EAST_COAST): GameState {
  return {
    config,
    seed: 1,
    roundNumber: 1,
    players: [p0, player({ hand: cards("7", 3) })],
    currentSeat: 0,
    phase: "play",
    stock: cards("8", 5),
    discard: [],
  };
}
const meldAll = (...groups: [Rank, Card[]][]): Action => ({
  type: "playMelds",
  melds: groups.map(([rank, cs]): MeldPlay => ({ rank, cardIds: cs.map((c) => c.id) })),
});
/** Play `action`, and say whether the table would call it a Marva. */
function play(state: GameState, action: Action): { marva: boolean; down: boolean } {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(r.error);
  const move = describeMove(1, 0, action, state, r.state);
  expect(gotDownByMarva(state, r.state, 0)).toBe(move?.marva === true);
  return { marva: move?.marva === true, down: r.state.players[0]!.isDown };
}

describe("what a lay-down is worth against the minimum", () => {
  it("counts every card at face value and each book it completes", () => {
    expect(layDownValue([{ rank: "K", cards: cards("K", 3) }], EAST_COAST)).toBe(30);
    const clean = { rank: "5" as Rank, cards: cards("5", 7) };
    const dirty = { rank: "6" as Rank, cards: [...cards("6", 6), card("2")] };
    expect(layDownValue([clean, dirty], EAST_COAST)).toBe(35 + 500 + 30 + 20 + 300);
    expect(layDownValue([], EAST_COAST)).toBe(0);
  });
});

describe("the Marva rule being used", () => {
  it("is a lay-down below the minimum that gets down by emptying the hand", () => {
    const fives = cards("5", 4);
    expect(play(table(player({ hand: fives })), meldAll(["5", fives]))).toEqual({
      marva: true,
      down: true,
    });
  });

  it("is not an ordinary get-down that reaches the minimum", () => {
    const kings = cards("K", 3);
    const aces = cards("A", 3);
    const state = table(player({ hand: [...kings, ...aces, card("9")] }));
    expect(play(state, meldAll(["K", kings], ["A", aces]))).toEqual({ marva: false, down: true });
  });

  it("is not a hand emptied by a lay-down that reached the minimum anyway", () => {
    // Exactly the minimum of 60: the rule was not needed.
    const queens = cards("Q", 3);
    const kings = cards("K", 3);
    const state = table(player({ hand: [...queens, ...kings] }));
    expect(play(state, meldAll(["Q", queens], ["K", kings]))).toEqual({ marva: false, down: true });
  });

  it("is not a play by someone already down", () => {
    const fives = cards("5", 3);
    const state = table(
      player({ hand: fives, isDown: true, melds: [{ rank: "K", cards: cards("K", 3) }] }),
    );
    expect(play(state, meldAll(["5", fives]))).toEqual({ marva: false, down: true });
  });

  it("cannot happen with the rule off: the same play is refused", () => {
    const fives = cards("5", 4);
    const r = applyAction(
      table(player({ hand: fives }), { ...EAST_COAST, marvaRule: false }),
      meldAll(["5", fives]),
    );
    expect(r.ok).toBe(false);
    // And a state pair from a table without the rule is never called one.
    const off = { ...EAST_COAST, marvaRule: false };
    const before = table(player({ hand: fives }), off);
    const after = {
      ...before,
      players: [player({ isDown: true, melds: [{ rank: "5", cards: fives }] }), before.players[1]!],
    };
    expect(gotDownByMarva(before, after, 0)).toBe(false);
  });

  it("follows a custom table's own minimum and card values, not a preset's", () => {
    // Keyed to the rule being on and used, never to a preset's name or numbers.
    const rules = (over: object): RulesConfig => {
      const r = resolveRules({ preset: "west-coast", mode: "competitive", rules: over });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    };
    const minimums = (first: number) => ({ layDownMinimums: [first, 90, 120, 150] });
    const fives = cards("5", 4); // 20 points at the preset's values
    const marva = (config: RulesConfig) =>
      play(table(player({ hand: fives }), config), meldAll(["5", fives])).marva;
    expect(marva(rules(minimums(30)))).toBe(true);
    expect(marva(rules(minimums(20)))).toBe(false);
    expect(marva(rules({ ...minimums(30), scoring: { fourToNine: 10 } }))).toBe(false);
    expect(marva(rules({ ...minimums(41), scoring: { fourToNine: 10 } }))).toBe(true);
    expect(() => marva(rules({ ...minimums(30), marvaRule: false }))).toThrow();
  });

  it("is not anything that leaves the player still not down, such as a draw", () => {
    const start = { ...table(player({ hand: cards("5", 2) })), phase: "draw" as const };
    const r = applyAction(start, { type: "draw" });
    expect(r.ok && gotDownByMarva(start, r.state, 0)).toBe(false);
  });

  it("is marked as a moment wherever it happens in a game, and only there", () => {
    const fives = cards("5", 4);
    const start = table(player({ hand: fives }));
    const timeline = buildTimeline({
      config: EAST_COAST,
      setup: { state: start },
      actions: [meldAll(["5", fives]), { type: "discard", cardId: start.players[0]!.foot[0]!.id }],
      names: ["Ana"],
    });
    expect(timeline.moments.filter((m) => m.kind === "marva")).toEqual([
      {
        id: "marva-1-0",
        kind: "marva",
        label: "Marva Rule: Ana got down by emptying the hand",
        step: 1,
        seat: 0,
      },
    ]);
    expect(timeline.entry(1).move?.marva).toBe(true);
    expect(timeline.entry(2).move?.marva).toBeUndefined();
  });
});
