import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { canTakePile } from "./feasibility";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `fz${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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

describe("canTakePile (already down)", () => {
  it("is feasible when a pile card forms a new meld with the hand", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("K")]);
    expect(canTakePile(s, 0).feasible).toBe(true);
  });

  it("is infeasible when no pile card can be played", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("9")]);
    expect(canTakePile(s, 0).feasible).toBe(false);
  });

  it("is infeasible for an empty pile", () => {
    const s = state({ isDown: true, hand: cards("K", 3) }, []);
    expect(canTakePile(s, 0).feasible).toBe(false);
  });
});

describe("canTakePile (not yet down, minimum 60)", () => {
  it("is feasible when the lay-down using a pile card reaches the minimum", () => {
    // 3 kings (30) from hand + 3 queens (30) where one queen is the pile card = 60
    const s = state({ hand: [...cards("K", 3), ...cards("Q", 2)] }, [card("Q")]);
    expect(canTakePile(s, 0).feasible).toBe(true);
  });

  it("is infeasible when the minimum is reachable only without a pile card", () => {
    // hand alone makes 60 (3 kings + 3 queens); the single pile 9 cannot be played
    const s = state({ hand: [...cards("K", 3), ...cards("Q", 3)] }, [card("9")]);
    expect(canTakePile(s, 0).feasible).toBe(false);
  });
});

describe("the witness plan is completable", () => {
  it("applies as a valid lay-down once the pile is in hand", () => {
    const pile = [card("Q")];
    const s = state({ hand: [...cards("K", 3), ...cards("Q", 2)] }, pile);
    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true);
    if (!f.feasible || !f.plan) return;
    // Simulate taking the pile: pile cards join the hand, then play the witness.
    const withPile: GameState = {
      ...s,
      phase: "play",
      discard: [],
      players: [{ ...s.players[0], hand: [...s.players[0].hand, ...pile] }, s.players[1]],
    };
    const r = applyAction(withPile, { type: "playMelds", melds: [...f.plan] });
    expect(r.ok).toBe(true);
  });
});
