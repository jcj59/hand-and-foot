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
import { legalHints } from "./legal";
import { applyAction } from "./reducer";
import { canTakePile } from "./feasibility";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `lh${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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
function table(p0: PlayerState, over: Partial<GameState>): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, player({ isDown: false })],
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
    ...over,
  };
}

describe("legalHints", () => {
  it("offers a draw and matches take-pile feasibility in the draw phase", () => {
    const s = table(player({ isDown: true, hand: cards("K", 2) }), {
      phase: "draw",
      discard: [card("K")],
    });
    const h = legalHints(s, 0);
    expect(h.canDraw).toBe(true);
    expect(h.canTakePile).toBe(canTakePile(s, 0).feasible);
    expect(h.canTakePile).toBe(true);
  });

  it("reports meldable ranks that the reducer then accepts (down player)", () => {
    const hand = [...cards("K", 3), ...cards("Q", 3), card("9")];
    const s = table(player({ isDown: true, hand }), { phase: "play" });
    const h = legalHints(s, 0);
    expect([...h.meldableRanks].sort()).toEqual(["K", "Q"]);
    for (const rank of h.meldableRanks) {
      const ids = hand.filter((c) => c.rank === rank).map((c) => c.id);
      const r = applyAction(s, { type: "playMelds", melds: [{ rank, cardIds: ids }] });
      expect(r.ok).toBe(true);
    }
  });

  it("reports canGoOut according to the go-out rule", () => {
    const p = player({
      isDown: true,
      inFoot: true,
      foot: [card("5")],
      melds: [cleanBook("K"), dirtyBook("Q"), dirtyBook("J")],
    });
    expect(legalHints(table(p, { phase: "play" }), 0).canGoOut).toBe(true);
  });

  it("offers nothing when it is not the seat's turn", () => {
    const h = legalHints(table(player({ isDown: true }), { phase: "play" }), 1);
    expect(h.canDraw).toBe(false);
    expect(h.meldableRanks).toEqual([]);
  });
});
