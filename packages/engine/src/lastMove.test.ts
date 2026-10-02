import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Action,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { describeMove, moveSeenBy, roundResult } from "./lastMove";
import { applyAction } from "./reducer";
import { scoreRound } from "./scoreRound";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `lm${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function player(over: Partial<PlayerState>): PlayerState {
  return {
    hand: [],
    foot: cards("4", 2),
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
    ...over,
  };
}
function stateWith(over: Partial<GameState>): GameState {
  return {
    config: EAST_COAST,
    seed: 3,
    roundNumber: 1,
    players: [player({ hand: [card("9")] }), player({ hand: [card("9")] })],
    currentSeat: 0,
    phase: "draw",
    stock: [card("Q", "hearts"), card("6")],
    discard: [card("8")],
    ...over,
  };
}
function apply(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("describeMove", () => {
  it("names the card drawn, from the drawer's active zone", () => {
    const before = stateWith({});
    const after = apply(before, { type: "draw" });
    expect(describeMove(4, 0, { type: "draw" }, before, after)).toEqual({
      seq: 4,
      seat: 0,
      kind: "draw",
      card: before.stock[0],
    });
    // In the foot, the card lands in the foot.
    const inFoot = stateWith({
      players: [player({ inFoot: true, foot: [card("9")] }), player({})],
    });
    const drew = apply(inFoot, { type: "draw" });
    expect(describeMove(0, 0, { type: "draw" }, inFoot, drew)?.card).toEqual(inFoot.stock[0]);
  });

  it("says a draw happened, with no card, when an exhausted stock ended the round instead", () => {
    const before = stateWith({ stock: [], config: { ...EAST_COAST, stockExhaustion: "end" } });
    const after = apply(before, { type: "draw" });
    const move = describeMove(1, 0, { type: "draw" }, before, after)!;
    expect(move).toEqual({ seq: 1, seat: 0, kind: "draw" });
    expect("card" in move).toBe(false);
  });

  it("counts the pile taken and the cards melded, and names the card discarded", () => {
    const kings = cards("K", 2);
    const before = stateWith({
      players: [
        player({ isDown: true, melds: [{ rank: "Q", cards: cards("Q", 3) }], hand: kings }),
        player({}),
      ],
      discard: [card("7"), card("K", "hearts")],
    });
    const took = apply(before, { type: "takePile" });
    expect(describeMove(2, 0, { type: "takePile" }, before, took)).toEqual({
      seq: 2,
      seat: 0,
      kind: "takePile",
      count: 2,
    });
    const meld: Action = {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: [...kings.map((c) => c.id), before.discard[1]!.id] }],
    };
    const melded = apply(took, meld);
    expect(describeMove(3, 0, meld, took, melded)).toEqual({
      seq: 3,
      seat: 0,
      kind: "meld",
      count: 3,
    });
    const back = apply(melded, { type: "takeBack" });
    expect(describeMove(4, 0, { type: "takeBack" }, melded, back)).toEqual({
      seq: 4,
      seat: 0,
      kind: "takeBack",
    });
    const sevenId = before.discard[0]!.id;
    const remelded = apply(back, meld);
    const discarded = apply(remelded, { type: "discard", cardId: sevenId });
    expect(describeMove(5, 0, { type: "discard", cardId: sevenId }, remelded, discarded)).toEqual({
      seq: 5,
      seat: 0,
      kind: "discard",
      card: before.discard[0],
    });
  });

  it("has nothing to say about dealing the next round", () => {
    const ended = stateWith({ roundEnded: true });
    const next = apply(ended, { type: "nextRound" });
    expect(describeMove(9, 0, { type: "nextRound" }, ended, next)).toBeNull();
  });
});

describe("moveSeenBy", () => {
  const drawn = card("A", "spades");
  const draw = { seq: 1, seat: 0, kind: "draw" as const, card: drawn };

  it("shows the drawer their card and nobody else", () => {
    expect(moveSeenBy(draw, 0)).toBe(draw);
    const seen = moveSeenBy(draw, 1);
    expect(seen).toEqual({ seq: 1, seat: 0, kind: "draw" });
    expect("card" in seen).toBe(false);
    expect(JSON.stringify(seen)).not.toContain(drawn.id);
  });

  it("passes every other move through unchanged, discards included", () => {
    const discard = { seq: 2, seat: 0, kind: "discard" as const, card: drawn };
    expect(moveSeenBy(discard, 1)).toBe(discard);
    const blind = { seq: 3, seat: 0, kind: "draw" as const };
    expect(moveSeenBy(blind, 1)).toBe(blind);
  });
});

describe("roundResult", () => {
  it("is null while the round is played, and the scores and standing once it ends", () => {
    expect(roundResult(stateWith({}))).toBeNull();
    const ended = stateWith({ roundEnded: true, wentOutSeat: 1 });
    expect(roundResult(ended)).toEqual({
      scores: scoreRound(ended),
      wentOutSeat: 1,
      roundNumber: 1,
      totals: scoreRound(ended).map((s) => s.score),
      matchOver: false,
    });
    const last = stateWith({ roundEnded: true, roundNumber: 4 });
    const result = roundResult(last)!;
    expect(result.matchOver).toBe(true);
    expect("wentOutSeat" in result).toBe(false);
    expect("departed" in result).toBe(false);
  });

  it("names everyone who has left the match, for the scoreboard", () => {
    const departed = [{ seat: 1, afterRound: 1 }];
    const ended = stateWith({ roundEnded: true, roundNumber: 2, departed });
    expect(roundResult(ended)!.departed).toEqual(departed);
  });
});
