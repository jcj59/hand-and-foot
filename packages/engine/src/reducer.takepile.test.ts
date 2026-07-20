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
  return { id: `tp${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function state(over: Partial<PlayerState>, discard: Card[]): GameState {
  const p: PlayerState = {
    hand: [],
    foot: [],
    melds: [],
    isDown: false,
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
    phase: "draw",
    stock: [],
    discard,
  };
}

describe("takePile", () => {
  it("moves the whole pile into the hand and records the obligation", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("K"), card("9")]);
    const r = applyAction(s, { type: "takePile" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.discard).toHaveLength(0);
    expect(r.state.players[0].hand).toHaveLength(4);
    expect(r.state.players[0].pickedUp ?? []).toHaveLength(2);
    expect(r.state.phase).toBe("play");
  });

  it("rejects taking the pile when infeasible", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("9")]);
    expect(applyAction(s, { type: "takePile" }).ok).toBe(false);
  });

  it("refuses to discard until a picked-up card is played", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("K"), card("9")]);
    const taken = applyAction(s, { type: "takePile" });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    const anyHandCard = taken.state.players[0].hand[0];
    const r = applyAction(taken.state, { type: "discard", cardId: anyHandCard.id });
    expect(r.ok).toBe(false);
  });

  it("clears the obligation once a picked-up card is played, then allows a discard", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("K"), card("9")]);
    const taken = applyAction(s, { type: "takePile" });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    const kings = taken.state.players[0].hand.filter((c) => c.rank === "K");
    const played = applyAction(taken.state, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: kings.map((c) => c.id) }],
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.players[0].pickedUp ?? []).toHaveLength(0);
    const nine = played.state.players[0].hand.find((c) => c.rank === "9");
    expect(nine).toBeDefined();
    const disc = applyAction(played.state, { type: "discard", cardId: nine!.id });
    expect(disc.ok).toBe(true);
  });
});
