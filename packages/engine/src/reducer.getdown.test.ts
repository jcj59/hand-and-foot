import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `g${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function stateWith(p0: PlayerState): GameState {
  const filler: PlayerState = {
    hand: [],
    foot: [],
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
  };
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, filler],
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
  };
}
function notDown(hand: Card[]): GameState {
  return stateWith({ hand, foot: [], melds: [], isDown: false, inFoot: false, footPending: false });
}

describe("getting-down minimum (round 1 = 60)", () => {
  it("accepts a first lay-down that meets the minimum and marks the player down", () => {
    const h = [...cards("K", 3), ...cards("Q", 3)]; // 30 + 30 = 60
    const r = applyAction(notDown(h), {
      type: "playMelds",
      melds: [
        { rank: "K", cardIds: h.slice(0, 3).map((c) => c.id) },
        { rank: "Q", cardIds: h.slice(3, 6).map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].isDown).toBe(true);
  });

  it("rejects a first lay-down below the minimum (45 < 60)", () => {
    const h = [...cards("K", 3), ...cards("5", 3)]; // 30 + 15 = 45
    const r = applyAction(notDown(h), {
      type: "playMelds",
      melds: [
        { rank: "K", cardIds: h.slice(0, 3).map((c) => c.id) },
        { rank: "5", cardIds: h.slice(3, 6).map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("counts a completed book's bonus toward the minimum (the bonus tips it)", () => {
    const seven = cards("5", 7); // 35 card value, below 60 alone; a clean book adds 500
    const withBook = applyAction(notDown(seven), {
      type: "playMelds",
      melds: [{ rank: "5", cardIds: seven.map((c) => c.id) }],
    });
    expect(withBook.ok).toBe(true);

    const six = cards("5", 6); // 30, not a book, below 60
    const withoutBook = applyAction(notDown(six), {
      type: "playMelds",
      melds: [{ rank: "5", cardIds: six.map((c) => c.id) }],
    });
    expect(withoutBook.ok).toBe(false);
  });

  it("applies no minimum once the player is already down", () => {
    const hand = cards("4", 3); // worth 15, well below 60
    const s = stateWith({
      hand,
      foot: [],
      melds: [],
      isDown: true,
      inFoot: false,
      footPending: false,
    });
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "4", cardIds: hand.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
  });
});
