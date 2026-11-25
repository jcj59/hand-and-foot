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

// A clean book (seven cards or more, all natural) never takes a wild card: one
// would dirty it. A dirty book may take more wilds, within the wild ratio, since
// its kind does not change. Naturals go on either. A play that completes a book
// may use wilds to do it, within the wild ratio.

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
  it("pins the refusal a player sees for a clean book", () => {
    const book = cards("9", 7);
    const joker = card("JOKER");
    const state = downWith([{ rank: "9", cards: book }], [joker, card("K"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("9", [joker])] });
    expect(r).toEqual({ ok: false, error: "a finished book cannot take a wild card" });
    expect(state.players[0].melds[0].cards).toHaveLength(7);
  });

  it("refuses a wild onto a clean book", () => {
    const book = cards("9", 7);
    const two = card("2");
    const state = downWith([{ rank: "9", cards: book }], [two, card("K"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("9", [two])] });
    expect(r).toEqual({ ok: false, error: "a finished book cannot take a wild card" });
  });

  it("lets a dirty book take a wild within the ratio, a joker as well as a two", () => {
    const book = [...cards("K", 5), card("2", "hearts"), card("2", "spades")];
    const joker = card("JOKER");
    const two = card("2", "diamonds");
    const state = downWith([{ rank: "K", cards: book }], [joker, two, card("8"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("K", [joker])] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].melds[0].cards).toHaveLength(8);
    const again = applyAction(r.state, { type: "playMelds", melds: [play("K", [two])] });
    expect(again.ok).toBe(true);
  });

  it("refuses a wild that would take a dirty book past the ratio, leaving it as it was", () => {
    // Four kings and three twos: the most wilds East Coast allows with four naturals.
    const book = [
      ...cards("K", 4),
      card("2", "hearts"),
      card("2", "spades"),
      card("2", "diamonds"),
    ];
    const joker = card("JOKER");
    const state = downWith([{ rank: "K", cards: book }], [joker, card("8"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("K", [joker])] });
    expect(r).toEqual({ ok: false, error: "naturals must outnumber wilds (East Coast)" });
    expect(state.players[0].melds[0].cards).toHaveLength(7);
  });

  it("lets a dirty book take a natural and a wild together within the ratio", () => {
    const book = [...cards("K", 5), card("2", "hearts"), card("2", "spades")];
    const king = card("K", "hearts");
    const two = card("2", "diamonds");
    const state = downWith([{ rank: "K", cards: book }], [king, two, card("8"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("K", [king, two])] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.players[0].melds[0].cards).toHaveLength(9);
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

  it("refuses a natural and a wild together onto a clean book, leaving the state as it was", () => {
    const book = cards("9", 7);
    const nine = card("9", "hearts");
    const two = card("2");
    const state = downWith([{ rank: "9", cards: book }], [nine, two, card("K"), card("Q")]);
    const r = applyAction(state, { type: "playMelds", melds: [play("9", [nine, two])] });
    expect(r).toEqual({ ok: false, error: "a finished book cannot take a wild card" });
  });

  it("refuses the pile when its wild could only go on a clean book", () => {
    const pileWild = card("2");
    const state: GameState = {
      ...downWith([{ rank: "K", cards: cards("K", 7) }], [card("K", "hearts"), card("9")]),
      phase: "draw",
      discard: [pileWild],
    };
    expect(applyAction(state, { type: "takePile" }).ok).toBe(false);
  });

  it("takes the pile when its wild can go on a dirty book, and settles it there", () => {
    const pileWild = card("2");
    const book = [...cards("K", 6), card("JOKER")];
    const state: GameState = {
      ...downWith([{ rank: "K", cards: book }], [card("Q", "hearts"), card("9")]),
      phase: "draw",
      discard: [pileWild],
    };
    const taken = applyAction(state, { type: "takePile" });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    const r = applyAction(taken.state, { type: "playMelds", melds: [play("K", [pileWild])] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.players[0].melds[0].cards).toHaveLength(8);
  });

  it("refuses the pile when its wild would take a dirty book past the ratio", () => {
    const pileWild = card("2");
    const book = [...cards("K", 4), card("2", "hearts"), card("2", "spades"), card("JOKER")];
    const state: GameState = {
      ...downWith([{ rank: "K", cards: book }], [card("Q", "hearts"), card("9")]),
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

  it("never lets a book of black threes take a wild", () => {
    const threes = cards("3", 7);
    const two = card("2");
    const state = downWith([{ rank: "3", cards: threes }], [two, card("K"), card("Q")], true);
    const r = applyAction(state, { type: "playMelds", melds: [play("3", [two])] });
    expect(r.ok).toBe(false);
  });
});
