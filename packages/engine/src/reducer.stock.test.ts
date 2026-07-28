import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type RulesConfig,
  type Suit,
} from "@hf/shared";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `st${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function emptyStock(discard: Card[], config: RulesConfig = EAST_COAST): GameState {
  const p: PlayerState = {
    hand: [],
    foot: [],
    melds: [],
    isDown: true,
    inFoot: false,
    footPending: false,
  };
  const q: PlayerState = {
    hand: [],
    foot: [],
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
  };
  return {
    config,
    seed: 99,
    roundNumber: 1,
    players: [p, q],
    currentSeat: 0,
    phase: "draw",
    stock: [],
    discard,
  };
}

function totalCards(s: GameState): number {
  return (
    s.stock.length +
    s.discard.length +
    s.players.reduce((n, p) => n + p.hand.length + p.foot.length, 0)
  );
}

describe("stock exhaustion", () => {
  it("reshuffles the discard pile into a new stock and draws, conserving cards", () => {
    const s = emptyStock(cards("9", 6));
    const before = totalCards(s);
    const r = applyAction(s, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.discard).toHaveLength(1); // top kept
    expect(r.state.players[0].hand).toHaveLength(1); // one drawn
    expect(r.state.stock).toHaveLength(4); // 6 - top - drawn
    expect(totalCards(r.state)).toBe(before);
    expect(r.state.phase).toBe("play");
  });

  it("ends the round on empty stock when configured to end", () => {
    const s = emptyStock(cards("9", 4), { ...EAST_COAST, stockExhaustion: "end" });
    const r = applyAction(s, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
  });

  it("is deterministic across the reshuffle", () => {
    const discard = cards("9", 6);
    const a = applyAction(emptyStock(discard), { type: "draw" });
    const b = applyAction(emptyStock(discard), { type: "draw" });
    expect(a).toEqual(b);
  });
});
