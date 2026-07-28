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
import { scoreRound } from "./scoreRound";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `sc${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number, suit: Suit = "clubs"): Card[] {
  return Array.from({ length: n }, () => card(rank, suit));
}
function cleanBook(rank: Rank): Meld {
  return { rank, cards: cards(rank, 7) };
}
function dirtyBook(rank: Rank): Meld {
  return { rank, cards: [...cards(rank, 6), card("2")] };
}
function player(over: Partial<PlayerState>): PlayerState {
  return { hand: [], foot: [], melds: [], isDown: true, inFoot: true, footPending: false, ...over };
}
function table(players: PlayerState[]): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
    roundEnded: true,
  };
}

describe("scoreRound", () => {
  it("scores a worked three-player end state exactly", () => {
    // Player 0 went out: 3 books plus the go-out bonus.
    //   clean K book: 7*10 = 70, + 500
    //   dirty Q book: 6*10 + 20 = 80, + 300
    //   dirty J book: 6*10 + 20 = 80, + 300
    //   go-out bonus: + 100  => 70+80+80 + 500+300+300 + 100 = 1430
    const p0 = player({ melds: [cleanBook("K"), dirtyBook("Q"), dirtyBook("J")] });
    // Player 1 holds three kings: -30
    const p1 = player({ inFoot: false, hand: cards("K", 3) });
    // Player 2 holds a red three (-500) and a black three (-5): -505
    const p2 = player({ inFoot: false, hand: [card("3", "hearts"), card("3", "spades")] });

    const result = scoreRound(table([p0, p1, p2]));
    expect(result.map((r) => r.score)).toEqual([1430, -30, -505]);
  });

  it("gives the go-out bonus only to the player with no cards", () => {
    const out = player({ melds: [cleanBook("K")] });
    const notOut = player({ inFoot: false, hand: cards("5", 1) });
    const [a, b] = scoreRound(table([out, notOut]));
    // out: 70 + 500 + 100 = 670 ; notOut: -5
    expect(a.score).toBe(670);
    expect(b.score).toBe(-5);
  });
});
