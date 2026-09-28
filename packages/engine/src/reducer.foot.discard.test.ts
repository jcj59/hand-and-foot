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

  it("picks the foot up by itself when the turn comes back, in place of the draw", () => {
    // Nothing to click: the foot replaces the draw and the pile is not open to
    // them, so the turn simply opens holding the foot.
    const last = card("5");
    const base = seat0({ hand: [last], foot: cards("K", 14) }, "play");
    const s: GameState = {
      ...base,
      players: [base.players[0], { ...base.players[1], hand: [card("6"), card("7")] }],
    };
    const discarded = applyAction(s, { type: "discard", cardId: last.id });
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    // Still pending through the other player's turn.
    expect(discarded.state.players[0].footPending).toBe(true);
    expect(discarded.state.players[0].inFoot).toBe(false);

    const drew = applyAction(discarded.state, { type: "draw" });
    expect(drew.ok).toBe(true);
    if (!drew.ok) return;
    const other = drew.state.players[1].hand[0];
    const back = applyAction(drew.state, { type: "discard", cardId: other.id });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.state.currentSeat).toBe(0);
    expect(back.state.phase).toBe("play");
    expect(back.state.players[0].inFoot).toBe(true);
    expect(back.state.players[0].footPending).toBe(false);
    // Only the other player's draw came off the stock.
    expect(back.state.stock).toHaveLength(4);
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
