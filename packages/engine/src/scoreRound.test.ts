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
function table(players: PlayerState[], wentOutSeat = 0): GameState {
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
    wentOutSeat,
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

  it("gives the go-out bonus only to the player who went out", () => {
    const out = player({ melds: [cleanBook("K")] });
    const notOut = player({ inFoot: false, hand: cards("5", 1) });
    const [a, b] = scoreRound(table([out, notOut]));
    // out: 70 + 500 + 100 = 670 ; notOut: -5
    expect(a.score).toBe(670);
    expect(b.score).toBe(-5);
  });

  it("gives no bonus to a cardless player who shed everything without going out", () => {
    // Both players hold nothing, but seat 1 is the one who went out.
    const shed = player({ melds: [cleanBook("K")] });
    const out = player({ melds: [cleanBook("Q")] });
    const [a, b] = scoreRound(table([shed, out], 1));
    expect(a.score).toBe(570); // 70 + 500, no go-out bonus
    expect(b.score).toBe(670); // 70 + 500 + 100
  });

  it("gives no bonus to anyone when the round ended without a go-out", () => {
    const p0 = player({ melds: [cleanBook("K")] });
    const s: GameState = { ...table([p0]), wentOutSeat: undefined };
    expect(scoreRound(s)[0].score).toBe(570);
  });

  // A book of black threes contains no wilds, so the wild count alone would call it
  // clean. The rule says otherwise, and the round score has to follow the rule.
  it("scores a black-three book as dirty despite it containing no wilds", () => {
    const p0 = player({ melds: [{ rank: "3", cards: cards("3", 7, "spades") }] });
    const s: GameState = { ...table([p0]), wentOutSeat: undefined };
    // 7 * 5 = 35 card points, + 300 dirty bonus, and no clean bonus.
    expect(scoreRound(s)[0].score).toBe(335);
  });

  // A red three is a pure penalty: it can never be melded (`playMelds` rejects it),
  // so the only place it can sit at scoring time is a hand or a foot, and it costs
  // 500 from either. Its configured value is negative, which is why `scoreRound`
  // subtracts the magnitude rather than the value.
  it("charges 500 for a red three whether it is left in the hand or the foot", () => {
    const inHand = player({ inFoot: false, hand: [card("3", "hearts")] });
    const inFoot = player({ inFoot: false, foot: [card("3", "diamonds")] });
    const [a, b] = scoreRound({ ...table([inHand, inFoot]), wentOutSeat: undefined });
    expect(a.score).toBe(-500);
    expect(b.score).toBe(-500);
  });

  it("scores an incomplete meld at card value with no book bonus", () => {
    const p0 = player({ melds: [{ rank: "K", cards: cards("K", 6) }] });
    const s: GameState = { ...table([p0]), wentOutSeat: undefined };
    expect(scoreRound(s)[0].score).toBe(60);
  });

  it("subtracts cards still held in the foot as well as in the hand", () => {
    const p0 = player({ inFoot: false, hand: cards("K", 2), foot: cards("5", 3) });
    const s: GameState = { ...table([p0]), wentOutSeat: undefined };
    expect(scoreRound(s)[0].score).toBe(-35); // -(2*10) - (3*5)
  });

  it("returns one entry per seat, in seat order", () => {
    const s = table([player({}), player({}), player({}), player({})], 2);
    expect(scoreRound(s).map((r) => r.seat)).toEqual([0, 1, 2, 3]);
  });
});
