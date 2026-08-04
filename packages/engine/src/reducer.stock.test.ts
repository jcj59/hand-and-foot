import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type RulesConfig,
  type Suit,
} from "@hf/shared";
import { applyAction } from "./reducer";
import { scoreRound } from "./scoreRound";
import { prng, shuffle } from "./rng";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `st${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function emptyStock(
  discard: Card[],
  config: RulesConfig = EAST_COAST,
  players?: PlayerState[],
): GameState {
  const p: PlayerState = {
    hand: [],
    foot: [],
    melds: [],
    isDown: true,
    inFoot: false,
    footPending: false,
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
    config,
    seed: 99,
    roundNumber: 1,
    players: players ?? [p, q],
    currentSeat: 0,
    phase: "draw",
    stock: [],
    discard,
  };
}

function totalCards(s: GameState): number {
  return (
    s.stock.length +
    s.discard.length +
    s.players.reduce((n, p) => n + p.hand.length + p.foot.length, 0)
  );
}

describe("stock exhaustion", () => {
  it("reshuffles the discard pile into a new stock and draws, conserving cards", () => {
    const s = emptyStock(cards("9", 6));
    const before = totalCards(s);
    const r = applyAction(s, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.discard).toHaveLength(1); // top kept
    expect(r.state.players[0].hand).toHaveLength(1); // one drawn
    expect(r.state.stock).toHaveLength(4); // 6 - top - drawn
    expect(totalCards(r.state)).toBe(before);
    expect(r.state.phase).toBe("play");
  });

  it("ends the round on empty stock when configured to end", () => {
    const s = emptyStock(cards("9", 4), { ...EAST_COAST, stockExhaustion: "end" });
    const r = applyAction(s, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
  });

  it("is deterministic across the reshuffle", () => {
    const discard = cards("9", 6);
    const a = applyAction(emptyStock(discard), { type: "draw" });
    const b = applyAction(emptyStock(discard), { type: "draw" });
    expect(a).toEqual(b);
  });

  // Determinism alone does not pin *which* order the reshuffle produces: any seed
  // derivation reproduces itself. Replay across a restart only stays exact if the
  // derivation is the documented one, so assert the order the seed actually implies.
  it("reshuffles with a seed derived from the game seed and round number", () => {
    // Distinct cards, so the assertion is about order rather than about counts.
    const discard = [card("4"), card("5"), card("6"), card("7"), card("8"), card("9")];
    const s = emptyStock(discard);
    const r = applyAction(s, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rest = discard.slice(0, -1);
    const expected = shuffle(rest, prng(s.seed + s.roundNumber + 1));
    // The first card off the reshuffled stock is the one drawn; the rest remains.
    expect(r.state.players[0].hand.map((c) => c.id)).toEqual([expected[0].id]);
    expect(r.state.stock.map((c) => c.id)).toEqual(expected.slice(1).map((c) => c.id));
  });

  it("reshuffles differently in a later round, so a reused pile is not re-dealt in order", () => {
    const discard = [card("4"), card("5"), card("6"), card("7"), card("8"), card("9")];
    const round1 = applyAction(emptyStock(discard), { type: "draw" });
    const round2 = applyAction({ ...emptyStock(discard), roundNumber: 2 }, { type: "draw" });
    expect(round1.ok && round2.ok).toBe(true);
    if (!round1.ok || !round2.ok) return;
    expect(round1.state.stock.map((c) => c.id)).not.toEqual(round2.state.stock.map((c) => c.id));
  });

  // Nothing is left to draw and nothing can be reshuffled: the top of the pile is
  // always retained, so a one-card pile has no cards below it. The round ends even
  // under the "reshuffle" setting.
  it("ends the round when the stock is empty and the pile holds a single card", () => {
    const only = card("9");
    const r = applyAction(emptyStock([only]), { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
    // No draw and no reshuffle happened.
    expect(r.state.stock).toHaveLength(0);
    expect(r.state.discard).toEqual([only]);
    expect(r.state.players[0].hand).toHaveLength(0);
    expect(r.state.phase).toBe("draw");
  });

  it("ends the round when both the stock and the pile are empty", () => {
    const r = applyAction(emptyStock([]), { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
    expect(r.state.stock).toHaveLength(0);
    expect(r.state.discard).toHaveLength(0);
  });

  it("awards no go-out bonus when the round ends this way, scoring melds and held cards as they are", () => {
    // Seat 0: a clean book of 5s (35 + 500) holding three kings (-30) => 505.
    // Seat 1: holding a red three => -500.
    const p0: PlayerState = {
      hand: cards("K", 3),
      foot: [],
      melds: [{ rank: "5", cards: cards("5", 7) }],
      isDown: true,
      inFoot: false,
      footPending: false,
    };
    const p1: PlayerState = {
      hand: [card("3", "hearts")],
      foot: [],
      melds: [],
      isDown: false,
      inFoot: false,
      footPending: false,
    };
    const r = applyAction(emptyStock([card("9")], EAST_COAST, [p0, p1]), { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
    expect(r.state.wentOutSeat).toBeUndefined();
    expect(scoreRound(r.state).map((s) => s.score)).toEqual([505, -500]);
  });

  // The foot-pending check runs before the stock check, so a player who emptied
  // their hand exactly as the stock ran out still gets their foot instead of having
  // the round end under them.
  it("still picks up a pending foot when the stock and the pile are both empty", () => {
    const foot = cards("K", 14);
    const pending: PlayerState = {
      hand: [],
      foot,
      melds: [],
      isDown: true,
      inFoot: false,
      footPending: true,
    };
    const other: PlayerState = {
      hand: [card("6")],
      foot: [],
      melds: [],
      isDown: false,
      inFoot: false,
      footPending: false,
    };
    const r = applyAction(emptyStock([], EAST_COAST, [pending, other]), { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.players[0].inFoot).toBe(true);
    expect(r.state.players[0].footPending).toBe(false);
    expect(r.state.players[0].foot).toHaveLength(14);
    expect(r.state.stock).toHaveLength(0);
    expect(r.state.phase).toBe("play");
  });
});
