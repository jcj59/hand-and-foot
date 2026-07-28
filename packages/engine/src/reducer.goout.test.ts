import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type Meld,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { applyAction } from "./reducer";
import { canGoOut } from "./goout";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `go${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function cleanBook(rank: Rank): Meld {
  return { rank, cards: cards(rank, 7) };
}
function dirtyBook(rank: Rank): Meld {
  return { rank, cards: [...cards(rank, 6), card("2")] };
}
function player(over: Partial<PlayerState>): PlayerState {
  return {
    hand: [],
    foot: [],
    melds: [],
    isDown: true,
    inFoot: false,
    footPending: false,
    ...over,
  };
}
function table(p0: PlayerState, n: number): GameState {
  const players: PlayerState[] = [p0];
  for (let i = 1; i < n; i++) players.push(player({ isDown: false }));
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
  };
}

const books = [cleanBook("K"), dirtyBook("Q"), dirtyBook("J")];

describe("canGoOut", () => {
  it("is false without the required books", () => {
    expect(
      canGoOut(player({ inFoot: true, melds: [cleanBook("K"), dirtyBook("Q")] }), EAST_COAST),
    ).toBe(false);
  });
  it("is false when not in the foot", () => {
    expect(canGoOut(player({ inFoot: false, melds: books }), EAST_COAST)).toBe(false);
  });
  it("is true with one clean and two dirty books in the foot", () => {
    expect(canGoOut(player({ inFoot: true, melds: books }), EAST_COAST)).toBe(true);
  });
});

describe("going out", () => {
  it("with a discard ends the round immediately", () => {
    const p0 = player({ inFoot: true, foot: [card("5")], melds: books });
    const r = applyAction(table(p0, 2), { type: "discard", cardId: p0.foot[0].id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
  });

  it("without a discard gives each other player exactly one more turn (final lap)", () => {
    const p0 = player({ inFoot: true, foot: cards("10", 3), melds: books });
    const r = applyAction(table(p0, 4), {
      type: "playMelds",
      melds: [{ rank: "10", cardIds: p0.foot.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.finalLapRemaining).toBe(3);
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.currentSeat).toBe(1);
  });

  it("ends the round when the final lap runs out", () => {
    const p0 = player({ inFoot: false, hand: [card("5"), card("6")] });
    const s = { ...table(p0, 2), finalLapRemaining: 1 };
    const r = applyAction(s, { type: "discard", cardId: p0.hand[0].id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
  });

  it("rejects going out without the required books", () => {
    const p0 = player({ inFoot: true, foot: [card("5")], melds: [cleanBook("K")] });
    const r = applyAction(table(p0, 2), { type: "discard", cardId: p0.foot[0].id });
    expect(r.ok).toBe(false);
  });
});
