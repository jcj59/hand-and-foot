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
import { applyAction } from "./reducer";

// Once a meld is a book (seven cards or more) its kind is settled: no wild card
// may be added to it, clean or dirty. Naturals still may. A play that completes a
// book may use wilds to do it, within the wild ratio.

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `b${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}

function downWith(melds: Meld[], hand: Card[], inFoot = false): GameState {
  const me: PlayerState = {
    hand: inFoot ? [] : hand,
    foot: inFoot ? hand : cards("4", 11),
    melds,
    isDown: true,
    inFoot,
    footPending: false,
  };
  const other: PlayerState = {
    hand: cards("5", 5),
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
    stock: cards("6", 10),
    discard: [card("7")],
  };
}

const play = (rank: Rank, ids: readonly Card[]) => ({ rank, cardIds: ids.map((c) => c.id) });

describe("a finished book and wild cards", () => {
  it("refuses a wild onto a clean book", () => {
    const book = cards("9", 7);
    const two = card("2");
    const state = downWith([{ rank: "9", cards: book }], [two, card("K"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("9", [two])] });
    expect(r).toEqual({ ok: false, error: "a finished book cannot take a wild card" });
  });

  it("refuses a wild onto a dirty book too, and a joker as much as a two", () => {
    const book = [...cards("K", 5), card("2", "hearts"), card("2", "spades")];
    const joker = card("JOKER");
    const state = downWith([{ rank: "K", cards: book }], [joker, card("8"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("K", [joker])] });
    expect(r.ok).toBe(false);
  });

  it("still takes a natural", () => {
    const book = cards("9", 7);
    const nine = card("9", "hearts");
    const state = downWith([{ rank: "9", cards: book }], [nine, card("K"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("9", [nine])] });
    expect(r.ok).toBe(true);
  });

  it("still lets a wild complete a book, within the wild ratio", () => {
    const six = cards("8", 6);
    const two = card("2");
    const state = downWith([{ rank: "8", cards: six }], [two, card("K"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("8", [two])] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.players[0].melds[0].cards).toHaveLength(7);
  });

  it("refuses a natural and a wild together onto a book, leaving the state as it was", () => {
    const book = cards("9", 7);
    const nine = card("9", "hearts");
    const two = card("2");
    const state = downWith([{ rank: "9", cards: book }], [nine, two, card("K"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("9", [nine, two])] });
    expect(r.ok).toBe(false);
  });

  it("refuses the pile when its wild could only go on a finished book", () => {
    const pileWild = card("2");
    const state: GameState = {
      ...downWith([{ rank: "K", cards: cards("K", 7) }], [card("K", "hearts"), card("9")]),
      phase: "draw",
      discard: [pileWild],
    };
    expect(applyAction(state, { type: "takePile" }).ok).toBe(false);
  });

  it("takes the pile when its wild joins naturals that complete a book in the same play", () => {
    const pileWild = card("2");
    const kings = [card("K", "hearts"), card("K", "spades")];
    const state: GameState = {
      ...downWith([{ rank: "K", cards: cards("K", 5) }], [...kings, card("9")]),
      phase: "draw",
      discard: [pileWild],
    };
    const taken = applyAction(state, { type: "takePile" });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    const r = applyAction(taken.state, {
      type: "playMelds",
      melds: [play("K", [...kings, pileWild])],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.players[0].melds[0].cards).toHaveLength(8);
  });

  it("applies to a book of black threes as to any other", () => {
    const threes = cards("3", 7);
    const two = card("2");
    const state = downWith([{ rank: "3", cards: threes }], [two, card("K"), card("Q")], true);
    const r = applyAction(state, { type: "playMelds", melds: [play("3", [two])] });
    expect(r).toEqual({ ok: false, error: "a finished book cannot take a wild card" });
  });
});
