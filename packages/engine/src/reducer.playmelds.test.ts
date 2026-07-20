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
  return { id: `p${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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

describe("playMelds (already down)", () => {
  it("lays a valid new meld and removes the cards from the hand", () => {
    const k = [card("K"), card("K"), card("K")];
    const s = gs(player({ hand: [...k, card("5")] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: k.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].melds).toHaveLength(1);
    expect(r.state.players[0].melds[0].cards).toHaveLength(3);
    expect(r.state.players[0].hand.map((c) => c.rank)).toEqual(["5"]);
  });

  it("extends the existing meld of a rank rather than making a second one", () => {
    const existing = [card("7"), card("7"), card("7")];
    const add = card("7");
    const wild = card("2");
    const s = gs(player({ melds: [{ rank: "7", cards: existing }], hand: [add, wild] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "7", cardIds: [add.id, wild.id] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].melds).toHaveLength(1);
    expect(r.state.players[0].melds[0].cards).toHaveLength(5);
  });

  it("rejects the whole submission if any meld is invalid, leaving state unchanged", () => {
    const good = [card("Q"), card("Q"), card("Q")];
    const bad = [card("9"), card("9")]; // only two cards
    const s = gs(player({ hand: [...good, ...bad] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [
        { rank: "Q", cardIds: good.map((c) => c.id) },
        { rank: "9", cardIds: bad.map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects playing a card that is not in the active zone", () => {
    const s = gs(player({ hand: [card("K"), card("K")] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: ["nope-1", "nope-2", "nope-3"] }],
    });
    expect(r.ok).toBe(false);
  });
});
