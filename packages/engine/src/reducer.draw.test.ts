import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { deal } from "./deal";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `dr${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function inFootAt(foot: Card[], stock: Card[]): GameState {
  const p: PlayerState = {
    hand: [],
    foot,
    melds: [],
    isDown: true,
    inFoot: true,
    footPending: false,
  };
  const q: PlayerState = {
    hand: [card("6")],
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
    players: [p, q],
    currentSeat: 0,
    phase: "draw",
    stock,
    discard: [card("8")],
  };
}

describe("draw", () => {
  it("moves the top stock card to the current player's hand and advances to play", () => {
    const s0 = deal(4, EAST_COAST, 123);
    const top = s0.stock[0];
    const r = applyAction(s0, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].hand.length).toBe(s0.players[0].hand.length + 1);
    expect(r.state.stock.length).toBe(s0.stock.length - 1);
    expect(r.state.players[0].hand.at(-1)).toEqual(top);
    expect(r.state.phase).toBe("play");
    expect(r.state.currentSeat).toBe(0);
  });

  it("is deterministic in the seed", () => {
    const a = applyAction(deal(4, EAST_COAST, 7), { type: "draw" });
    const b = applyAction(deal(4, EAST_COAST, 7), { type: "draw" });
    expect(a).toEqual(b);
  });

  it("rejects a draw outside the draw phase", () => {
    const s0 = deal(4, EAST_COAST, 1);
    const first = applyAction(s0, { type: "draw" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyAction(first.state, { type: "draw" });
    expect(second.ok).toBe(false);
  });

  // Once a player is in their foot the draw must land there, not in the (empty)
  // hand, and it must go to the end of the existing foot cards.
  it("appends to a foot that already holds cards, leaving the hand empty", () => {
    const foot = cards("K", 3);
    const top = card("A");
    const r = applyAction(inFootAt([...foot], [top, card("7")]), { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].foot).toHaveLength(4);
    expect(r.state.players[0].foot.at(-1)).toEqual(top);
    expect(r.state.players[0].hand).toHaveLength(0);
    expect(r.state.stock).toHaveLength(1);
    expect(r.state.phase).toBe("play");
  });

  // With initialDiscardFlip off there is no pile on the opening turn, so drawing is
  // the only way to start.
  it("is the only option on the opening turn when no card was flipped to the pile", () => {
    const s = deal(4, { ...EAST_COAST, initialDiscardFlip: false }, 5);
    expect(s.discard).toHaveLength(0);

    const take = applyAction(s, { type: "takePile" });
    expect(take.ok).toBe(false);
    if (take.ok) return;
    expect(take.error).toMatch(/pile is empty/);

    const drew = applyAction(s, { type: "draw" });
    expect(drew.ok).toBe(true);
    if (!drew.ok) return;
    expect(drew.state.players[0].hand).toHaveLength(15);
    expect(drew.state.discard).toHaveLength(0);
  });
});
