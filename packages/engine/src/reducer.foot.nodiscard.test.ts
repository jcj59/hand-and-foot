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
  return { id: `fn${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function downPlayer(hand: Card[], foot: Card[]): GameState {
  const p: PlayerState = { hand, foot, melds: [], isDown: true, inFoot: false, footPending: false };
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
    phase: "play",
    stock: [],
    discard: [],
  };
}

describe("foot transition without a discard", () => {
  it("picks up the foot when the hand empties via melds and stays in the play phase", () => {
    const kings = cards("K", 3);
    const s = downPlayer([...kings], [...cards("A", 3), card("9")]);
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: kings.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].inFoot).toBe(true);
    expect(r.state.players[0].hand).toHaveLength(0);
    expect(r.state.players[0].foot).toHaveLength(4);
    expect(r.state.phase).toBe("play");
  });

  it("lets the player immediately meld from the foot in the same turn", () => {
    const kings = cards("K", 3);
    const aces = cards("A", 3);
    const s = downPlayer([...kings], [...aces, card("9")]);
    const r1 = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: kings.map((c) => c.id) }],
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyAction(r1.state, {
      type: "playMelds",
      melds: [{ rank: "A", cardIds: aces.map((c) => c.id) }],
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.players[0].melds.find((m) => m.rank === "A")?.cards).toHaveLength(3);
    expect(r2.state.players[0].foot).toHaveLength(1);
  });

  it("does not transition when the hand is not emptied", () => {
    const kings = cards("K", 3);
    const s = downPlayer([...kings, card("9")], cards("A", 5));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: kings.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].inFoot).toBe(false);
  });
});
