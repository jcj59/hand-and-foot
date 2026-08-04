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
import { bookCounts, canGoOut } from "./goout";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `go${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function cleanBook(rank: Rank): Meld {
  return { rank, cards: cards(rank, 7) };
}
function dirtyBook(rank: Rank): Meld {
  return { rank, cards: [...cards(rank, 6), card("2")] };
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
function table(p0: PlayerState, n: number): GameState {
  const players: PlayerState[] = [p0];
  for (let i = 1; i < n; i++) players.push(player({ isDown: false }));
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
  };
}

const books = [cleanBook("K"), dirtyBook("Q"), dirtyBook("J")];

describe("bookCounts", () => {
  it("counts completed books by kind and ignores incomplete melds", () => {
    const p = player({
      melds: [cleanBook("K"), dirtyBook("Q"), dirtyBook("J"), { rank: "5", cards: cards("5", 4) }],
    });
    expect(bookCounts(p)).toEqual({ clean: 1, dirty: 2 });
  });

  it("counts nothing for a player with no melds", () => {
    expect(bookCounts(player({}))).toEqual({ clean: 0, dirty: 0 });
  });
});

describe("canGoOut", () => {
  it("is false without the required books", () => {
    expect(
      canGoOut(player({ inFoot: true, melds: [cleanBook("K"), dirtyBook("Q")] }), EAST_COAST),
    ).toBe(false);
  });
  // The two requirements are independent: neither one on its own is enough. The
  // clean requirement is the easier one to drop by accident, because a dirty book
  // is the commoner shape.
  it("is false with enough dirty books but no clean book", () => {
    const p = player({ inFoot: true, melds: [dirtyBook("Q"), dirtyBook("J"), dirtyBook("10")] });
    expect(canGoOut(p, EAST_COAST)).toBe(false);
    expect(bookCounts(p)).toEqual({ clean: 0, dirty: 3 });
  });

  it("is false with enough clean books but too few dirty books", () => {
    const p = player({ inFoot: true, melds: [cleanBook("K"), cleanBook("A")] });
    expect(canGoOut(p, EAST_COAST)).toBe(false);
  });

  it("is false when not in the foot", () => {
    expect(canGoOut(player({ inFoot: false, melds: books }), EAST_COAST)).toBe(false);
  });
  it("is true with one clean and two dirty books in the foot", () => {
    expect(canGoOut(player({ inFoot: true, melds: books }), EAST_COAST)).toBe(true);
  });
});

describe("going out", () => {
  it("with a discard ends the round immediately", () => {
    const p0 = player({ inFoot: true, foot: [card("5")], melds: books });
    const r = applyAction(table(p0, 2), { type: "discard", cardId: p0.foot[0].id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
  });

  it("without a discard gives each other player exactly one more turn (final lap)", () => {
    const p0 = player({ inFoot: true, foot: cards("10", 3), melds: books });
    const r = applyAction(table(p0, 4), {
      type: "playMelds",
      melds: [{ rank: "10", cardIds: p0.foot.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.finalLapRemaining).toBe(3);
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.currentSeat).toBe(1);
  });

  it("ends the round when the final lap runs out", () => {
    const p0 = player({ inFoot: false, hand: [card("5"), card("6")] });
    const s = { ...table(p0, 2), finalLapRemaining: 1 };
    const r = applyAction(s, { type: "discard", cardId: p0.hand[0].id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
  });

  it("runs the final lap through every other seat and never returns to the winner", () => {
    const tens = cards("10", 3);
    const winner = player({ inFoot: true, foot: [...tens], melds: books });
    const s: GameState = {
      config: EAST_COAST,
      seed: 0,
      roundNumber: 1,
      players: [
        winner,
        player({ isDown: false, hand: [card("6"), card("7")] }),
        player({ isDown: false, hand: [card("6"), card("7")] }),
        player({ isDown: false, hand: [card("6"), card("7")] }),
      ],
      currentSeat: 0,
      phase: "play",
      stock: cards("9", 10),
      discard: [card("8")],
    };

    const out = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "10", cardIds: tens.map((c) => c.id) }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    let state = out.state;
    expect(state.wentOutSeat).toBe(0);
    expect(state.finalLapRemaining).toBe(3);
    const winnerAfterGoingOut = JSON.stringify(state.players[0]);

    // Each remaining seat takes exactly one turn.
    for (const seat of [1, 2, 3]) {
      expect(state.currentSeat).toBe(seat);
      expect(state.roundEnded ?? false).toBe(false);
      const drew = applyAction(state, { type: "draw" });
      expect(drew.ok).toBe(true);
      if (!drew.ok) return;
      const disc = applyAction(drew.state, {
        type: "discard",
        cardId: drew.state.players[seat].hand[0].id,
      });
      expect(disc.ok).toBe(true);
      if (!disc.ok) return;
      state = disc.state;
    }

    // The lap is spent, the round is over, and the winner's cards never changed.
    expect(state.roundEnded).toBe(true);
    expect(state.finalLapRemaining).toBe(0);
    expect(state.wentOutSeat).toBe(0);
    expect(JSON.stringify(state.players[0])).toBe(winnerAfterGoingOut);
    // Even though the seat pointer has wrapped back, the winner cannot act again.
    expect(applyAction(state, { type: "draw" }).ok).toBe(false);
  });

  it("does not go out when the last card is shed without the required books", () => {
    const p0 = player({ inFoot: true, foot: [card("5")], melds: [cleanBook("K")] });
    const r = applyAction(table(p0, 2), { type: "discard", cardId: p0.foot[0].id });
    // The discard is legal; the player is simply left cardless and the round runs on.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.wentOutSeat).toBeUndefined();
  });
});
