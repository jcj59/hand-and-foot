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
  return { id: `fd${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function seat0(over: Partial<PlayerState>, phase: "draw" | "play"): GameState {
  const p: PlayerState = {
    hand: [],
    foot: [],
    melds: [],
    isDown: true,
    inFoot: false,
    footPending: false,
    ...over,
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
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p, q],
    currentSeat: 0,
    phase,
    stock: cards("9", 5),
    discard: [],
  };
}

describe("foot transition with a discard", () => {
  it("sets footPending when the last hand card is discarded", () => {
    const last = card("5");
    const s = seat0({ hand: [last], foot: cards("K", 14) }, "play");
    const r = applyAction(s, { type: "discard", cardId: last.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].footPending).toBe(true);
    expect(r.state.players[0].inFoot).toBe(false);
  });

  it("consumes the foot as the next draw and does not touch the stock", () => {
    const s = seat0({ footPending: true, foot: cards("K", 14) }, "draw");
    const r = applyAction(s, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].inFoot).toBe(true);
    expect(r.state.players[0].footPending).toBe(false);
    expect(r.state.stock).toHaveLength(5);
    expect(r.state.phase).toBe("play");
  });

  it("does not set footPending for a discard that leaves cards in hand", () => {
    const keep = card("6");
    const s = seat0({ hand: [card("5"), keep], foot: cards("K", 14) }, "play");
    const r = applyAction(s, { type: "discard", cardId: s.players[0].hand[0].id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].footPending).toBe(false);
  });
});
