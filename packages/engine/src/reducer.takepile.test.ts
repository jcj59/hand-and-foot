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
import { canTakePile } from "./feasibility";
import { legalHints } from "./legal";
import { deal } from "./deal";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `tp${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function state(
  over: Partial<PlayerState>,
  discard: Card[],
  gameOver: Partial<GameState> = {},
): GameState {
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
    ...gameOver,
  };
}

describe("takePile", () => {
  it("moves the whole pile into the hand and records the obligation", () => {
    const hand = cards("K", 2);
    const pile = [card("K"), card("9")];
    const s = state({ isDown: true, hand: [...hand] }, [...pile]);
    const r = applyAction(s, { type: "takePile" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.discard).toHaveLength(0);
    // The pile joins the end of the hand, in pile order.
    expect(r.state.players[0].hand.map((c) => c.id)).toEqual([...hand, ...pile].map((c) => c.id));
    expect(r.state.players[0].pickedUp).toEqual(pile.map((c) => c.id));
    expect(r.state.phase).toBe("play");
  });

  it("rejects taking the pile when infeasible", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("9")]);
    expect(applyAction(s, { type: "takePile" }).ok).toBe(false);
  });

  it("refuses to discard until a picked-up card is played", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("K"), card("9")]);
    const taken = applyAction(s, { type: "takePile" });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    const anyHandCard = taken.state.players[0].hand[0];
    const r = applyAction(taken.state, { type: "discard", cardId: anyHandCard.id });
    expect(r.ok).toBe(false);
  });

  it("clears the obligation once a picked-up card is played, then allows a discard", () => {
    const s = state({ isDown: true, hand: cards("K", 2) }, [card("K"), card("9")]);
    const taken = applyAction(s, { type: "takePile" });
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    const kings = taken.state.players[0].hand.filter((c) => c.rank === "K");
    const played = applyAction(taken.state, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: kings.map((c) => c.id) }],
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.players[0].pickedUp ?? []).toHaveLength(0);
    const nine = played.state.players[0].hand.find((c) => c.rank === "9");
    expect(nine).toBeDefined();
    const disc = applyAction(played.state, { type: "discard", cardId: nine!.id });
    expect(disc.ok).toBe(true);
  });

  it("appends the pile to a foot that already holds cards", () => {
    const foot = cards("K", 2);
    const pile = [card("K"), card("9")];
    const s = state({ isDown: true, inFoot: true, foot: [...foot] }, [...pile]);
    const r = applyAction(s, { type: "takePile" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].foot.map((c) => c.id)).toEqual([...foot, ...pile].map((c) => c.id));
    expect(r.state.players[0].hand).toHaveLength(0);
    expect(r.state.players[0].pickedUp).toEqual(pile.map((c) => c.id));
    expect(r.state.phase).toBe("play");
  });

  it("can only be taken during the draw phase, so never twice in one turn", () => {
    // Directly in the play phase, with a pile that would otherwise be takeable.
    const inPlay = state({ isDown: true, hand: cards("K", 2) }, [card("K"), card("9")], {
      phase: "play",
    });
    const rejected = applyAction(inPlay, { type: "takePile" });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toMatch(/draw phase/);

    // And a second take in the same turn hits the same guard.
    const first = applyAction(
      state({ isDown: true, hand: cards("K", 2) }, [card("K"), card("9")]),
      {
        type: "takePile",
      },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyAction(first.state, { type: "takePile" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatch(/draw phase/);
  });

  it("is refused on the turn a pending foot must be picked up", () => {
    // Discarding the last hand card leaves the foot pending for next turn.
    const last = card("5");
    const s = state({ isDown: true, hand: [last], foot: cards("A", 14) }, [card("K"), card("9")], {
      phase: "play",
    });
    const discarded = applyAction(s, { type: "discard", cardId: last.id });
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.state.players[0].footPending).toBe(true);

    // Back to this seat: the pile is takeable on paper, but the foot comes first.
    const back: GameState = { ...discarded.state, currentSeat: 0, phase: "draw" };
    expect(legalHints(back, 0).canTakePile).toBe(false);
    const take = applyAction(back, { type: "takePile" });
    expect(take.ok).toBe(false);
    if (take.ok) return;
    expect(take.error).toMatch(/pick up your foot/);

    // Drawing picks up the foot and leaves the pile untouched for everyone else.
    const drew = applyAction(back, { type: "draw" });
    expect(drew.ok).toBe(true);
    if (!drew.ok) return;
    expect(drew.state.players[0].inFoot).toBe(true);
    expect(drew.state.players[0].footPending).toBe(false);
    expect(drew.state.discard).toHaveLength(3);
  });

  it("keeps the obligation when the melds played come only from the hand", () => {
    const queens = cards("Q", 3);
    const handKings = cards("K", 2);
    const pileKing = card("K");
    const nine = card("9");
    const s = state({ isDown: true, hand: [...queens, ...handKings] }, [pileKing, nine]);
    const took = applyAction(s, { type: "takePile" });
    expect(took.ok).toBe(true);
    if (!took.ok) return;
    expect(took.state.players[0].pickedUp).toEqual([pileKing.id, nine.id]);

    // Melding the queens uses no picked-up card, so the debt stands.
    const handOnly = applyAction(took.state, {
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: queens.map((c) => c.id) }],
    });
    expect(handOnly.ok).toBe(true);
    if (!handOnly.ok) return;
    expect(handOnly.state.players[0].pickedUp).toEqual([pileKing.id, nine.id]);

    const blocked = applyAction(handOnly.state, { type: "discard", cardId: nine.id });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toMatch(/taken from the pile/);

    // Melding the kings does use the picked-up king, which settles it.
    const withPile = applyAction(handOnly.state, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: [...handKings, pileKing].map((c) => c.id) }],
    });
    expect(withPile.ok).toBe(true);
    if (!withPile.ok) return;
    expect(withPile.state.players[0].pickedUp).toEqual([]);
    expect(applyAction(withPile.state, { type: "discard", cardId: nine.id }).ok).toBe(true);
  });

  it("still owes the round minimum after taking the pile when not yet down", () => {
    const kings = cards("K", 3);
    const handQueens = cards("Q", 2);
    const pileQueen = card("Q");
    const s = state({ hand: [...kings, ...handQueens] }, [pileQueen]);
    const took = applyAction(s, { type: "takePile" });
    expect(took.ok).toBe(true);
    if (!took.ok) return;

    // The queens alone are 30, under the 60 minimum, even though they settle the
    // pile obligation.
    const short = applyAction(took.state, {
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: [...handQueens, pileQueen].map((c) => c.id) }],
    });
    expect(short.ok).toBe(false);
    if (short.ok) return;
    expect(short.error).toMatch(/below the round minimum/);
    expect(took.state.players[0].isDown).toBe(false);

    // Kings and queens together make exactly 60.
    const full = applyAction(took.state, {
      type: "playMelds",
      melds: [
        { rank: "K", cardIds: kings.map((c) => c.id) },
        { rank: "Q", cardIds: [...handQueens, pileQueen].map((c) => c.id) },
      ],
    });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.state.players[0].isDown).toBe(true);
    expect(full.state.players[0].pickedUp).toEqual([]);
  });

  it("cannot take a pile whose only card is a red three", () => {
    const s = state({ isDown: true, hand: cards("K", 3) }, [card("3", "hearts")]);
    expect(canTakePile(s, 0).feasible).toBe(false);
    const r = applyAction(s, { type: "takePile" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/cannot take the pile/);
  });

  it("takes a pile containing a red three, which can then be discarded", () => {
    const handKings = cards("K", 2);
    const spare = card("5");
    const redThree = card("3", "hearts");
    const pileKing = card("K");
    const s = state({ isDown: true, hand: [...handKings, spare] }, [redThree, pileKing]);
    const took = applyAction(s, { type: "takePile" });
    expect(took.ok).toBe(true);
    if (!took.ok) return;

    const laid = applyAction(took.state, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: [...handKings, pileKing].map((c) => c.id) }],
    });
    expect(laid.ok).toBe(true);
    if (!laid.ok) return;
    expect(laid.state.players[0].pickedUp).toEqual([]);

    // The red three can never be melded, but it can be shed as the discard.
    const r = applyAction(laid.state, { type: "discard", cardId: redThree.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.discard.at(-1)?.id).toBe(redThree.id);
    expect(r.state.players[0].hand.map((c) => c.id)).toEqual([spare.id]);
  });
});

describe("taking the pile on the opening turn", () => {
  it("is possible when the flipped card completes a minimum lay-down", () => {
    const s = deal(4, EAST_COAST, 36);
    expect(s.roundNumber).toBe(1);
    expect(s.discard).toHaveLength(1);
    expect(s.players.every((p) => !p.isDown)).toBe(true);

    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true);
    if (!f.plan) return;

    const took = applyAction(s, { type: "takePile" });
    expect(took.ok).toBe(true);
    if (!took.ok) return;
    expect(took.state.players[0].hand).toHaveLength(15); // 14 dealt plus the flip
    expect(took.state.players[0].pickedUp).toEqual(s.discard.map((c) => c.id));
    expect(took.state.discard).toHaveLength(0);

    const laid = applyAction(took.state, { type: "playMelds", melds: [...f.plan] });
    expect(laid.ok).toBe(true);
    if (!laid.ok) return;
    expect(laid.state.players[0].isDown).toBe(true);
    expect(laid.state.players[0].pickedUp).toEqual([]);
  });

  it("is refused on an opening hand that cannot reach the minimum with the flip", () => {
    const s = deal(4, EAST_COAST, 1);
    expect(canTakePile(s, 0).feasible).toBe(false);
    expect(legalHints(s, 0).canTakePile).toBe(false);

    const r = applyAction(s, { type: "takePile" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/cannot take the pile/);
    // Drawing is still there.
    expect(applyAction(s, { type: "draw" }).ok).toBe(true);
  });

  // Sweep real openings: whenever the solver green-lights an opening take, taking
  // the pile and playing the witness plan must both succeed and get the player down.
  it("never green-lights an opening take it cannot complete, across 200 deals", () => {
    let feasible = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = deal(4, EAST_COAST, seed);
      const f = canTakePile(s, 0);
      if (!f.feasible || !f.plan) continue;
      feasible++;

      const took = applyAction(s, { type: "takePile" });
      expect(took.ok).toBe(true);
      if (!took.ok) continue;
      const laid = applyAction(took.state, { type: "playMelds", melds: [...f.plan] });
      expect(laid.ok).toBe(true);
      if (!laid.ok) continue;
      expect(laid.state.players[0].isDown).toBe(true);
    }
    // Opening takes are rare; if none occurred the sweep proves nothing.
    expect(feasible).toBeGreaterThan(0);
  });
});
