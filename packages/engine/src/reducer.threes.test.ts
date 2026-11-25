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
    const s = gs(player({ foot: [...blacks, card("9")], inFoot: true }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "3", cardIds: blacks.map((c) => c.id) }],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a black-three book of seven from the foot and classifies it dirty", () => {
    const blacks = cards("3", 7, "spades");
    // A spare foot card so melding the book does not empty the foot (which would
    // require the go-out books).
    const s = gs(player({ foot: [...blacks, card("9")], inFoot: true }));
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

  it("rejects a black-three book made up with a wild, new or extending one down", () => {
    const blacks = cards("3", 6, "spades");
    const wild = card("2", "hearts");
    const fresh = gs(player({ foot: [...blacks, wild, card("9")], inFoot: true }));
    const r1 = applyAction(fresh, {
      type: "playMelds",
      melds: [{ rank: "3", cardIds: [...blacks, wild].map((c) => c.id) }],
    });
    expect(r1.ok).toBe(false);

    const down = cards("3", 7, "clubs");
    const extend = gs(
      player({ foot: [wild, card("9")], inFoot: true, melds: [{ rank: "3", cards: down }] }),
    );
    const r2 = applyAction(extend, {
      type: "playMelds",
      melds: [{ rank: "3", cardIds: [wild.id] }],
    });
    expect(r2.ok).toBe(false);
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
