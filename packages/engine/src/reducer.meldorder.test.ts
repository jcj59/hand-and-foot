import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type Meld,
  type PlayerState,
  type Rank,
} from "@hf/shared";
import { applyAction } from "./reducer";

// The table's "Newest first" sort shows a player's melds with the latest laid at
// the front, and it reads that order straight from `PlayerState.melds`: a new rank
// goes on the end, and a meld that grows stays where it was. Pinned here so the
// order the client depends on cannot change by accident.

let idc = 0;
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => ({ id: `o${idc++}`, rank, suit: "clubs" as const }));
}

function downWith(melds: Meld[], hand: Card[]): GameState {
  const me: PlayerState = {
    hand,
    foot: [],
    melds,
    isDown: true,
    inFoot: false,
    footPending: false,
  };
  const other: PlayerState = {
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
    players: [me, other],
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
  };
}

describe("the order melds are kept in", () => {
  it("adds a new rank at the end and grows an old one in place", () => {
    const queens = cards("Q", 3);
    const eights = cards("8", 3);
    const fives = cards("5", 3);
    const extraQueen = cards("Q", 1);
    const state = downWith(
      [
        { rank: "Q", cards: queens },
        { rank: "8", cards: eights },
      ],
      [...fives, ...extraQueen, ...cards("K", 2)],
    );
    // In one play: a new meld of fives, and a fourth queen onto the first meld.
    const r = applyAction(state, {
      type: "playMelds",
      melds: [
        { rank: "5", cardIds: fives.map((c) => c.id) },
        { rank: "Q", cardIds: extraQueen.map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const melds = r.state.players[0].melds;
    expect(melds.map((m) => m.rank)).toEqual(["Q", "8", "5"]);
    expect(melds[0].cards).toHaveLength(4);
  });
});
