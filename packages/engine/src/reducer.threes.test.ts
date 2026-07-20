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
import { classifyBook } from "./scoring";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `t3${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number, suit: Suit = "clubs"): Card[] {
  return Array.from({ length: n }, () => card(rank, suit));
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
function gs(p0: PlayerState): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, player({ isDown: false })],
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
  };
}

describe("red and black three rules", () => {
  it("rejects a submission containing a red three", () => {
    const reds = [card("3", "hearts"), card("3", "diamonds"), card("3", "hearts")];
    const s = gs(player({ hand: reds }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "3", cardIds: reds.map((c) => c.id) }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a black-three meld of fewer than seven cards", () => {
    const blacks = cards("3", 3, "spades");
    const s = gs(player({ foot: blacks, inFoot: true }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "3", cardIds: blacks.map((c) => c.id) }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a black-three book of seven from the foot and classifies it dirty", () => {
    const blacks = cards("3", 7, "spades");
    const s = gs(player({ foot: blacks, inFoot: true }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "3", cardIds: blacks.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meld = r.state.players[0].melds.find((m) => m.rank === "3");
    expect(meld).toBeDefined();
    expect(classifyBook(meld!)).toBe("dirty");
  });

  it("rejects a black-three book played from the hand rather than the foot", () => {
    const blacks = cards("3", 7, "spades");
    const s = gs(player({ hand: blacks, inFoot: false }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "3", cardIds: blacks.map((c) => c.id) }],
    });
    expect(r.ok).toBe(false);
  });
});
