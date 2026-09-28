import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  WEST_COAST,
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

  // A new meld needs three naturals. Reporting a pair feasible would hand back a
  // plan the reducer then rejects, breaking the solver's soundness guarantee.
  it("will not form a new meld from a pair", () => {
    const s = state({ isDown: true, hand: [card("K")] }, [card("K")]);
    expect(canTakePile(s, 0).feasible).toBe(false);

    // One more natural and the same position becomes feasible.
    const three = state({ isDown: true, hand: cards("K", 2) }, [card("K")]);
    expect(canTakePile(three, 0).feasible).toBe(true);
  });

  // Extending an existing meld needs only one card, which is the other half of the
  // rule above and the reason the threshold is conditional.
  it("extends an existing meld with a single pile card", () => {
    const s = state({ isDown: true, melds: [{ rank: "K", cards: cards("K", 3) }] }, [card("K")]);
    expect(canTakePile(s, 0).feasible).toBe(true);
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

describe("book bonuses in the minimum calculation", () => {
  it("counts a book the pile would complete toward the minimum", () => {
    // Six fours in hand plus one from the pile is a clean book: 35 in card value
    // plus the 500 bonus clears 60, which the cards alone never would.
    const s = state({ hand: cards("4", 6) }, [card("4")]);
    expect(canTakePile(s, 0).feasible).toBe(true);
  });

  it("is infeasible when the same low cards fall short of a book", () => {
    const s = state({ hand: cards("4", 2) }, [card("4")]); // three fours = 15
    expect(canTakePile(s, 0).feasible).toBe(false);
  });

  it("does not add a second bonus for a meld that is already a book", () => {
    const extra = card("4");
    const s = state({ isDown: true, melds: [{ rank: "4", cards: cards("4", 7) }] }, [extra]);
    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true); // already down, so no minimum applies
    expect(f.plan).toEqual([{ rank: "4", cardIds: [extra.id] }]);
  });

  it("applies no minimum in a round the config does not configure one for", () => {
    // layDownMinimums has a single entry, so round 2 falls back to no minimum.
    const s: GameState = { ...state({ hand: cards("4", 2) }, [card("4")]), roundNumber: 2 };
    expect(canTakePile(s, 0).feasible).toBe(true);
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

describe("spending wilds to take the pile", () => {
  // The solver used to build melds from naturals only, so a take that needed a wild
  // was refused even when it was plainly legal — found in a real game, where a
  // player holding two queens and a joker could not take a queen.
  it("makes the pile card's pair a meld with a wild to reach the minimum", () => {
    const joker = card("JOKER");
    const queens = cards("Q", 2);
    const s = state({ hand: [...queens, joker, card("7"), card("9")] }, [card("Q")]);
    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true);
    // Three queens and the joker: 30 + 50 = 80, over the 60 minimum.
    expect(f.plan).toEqual([
      { rank: "Q", cardIds: expect.arrayContaining([...queens.map((c) => c.id), joker.id]) },
    ]);
    const took = applyAction(s, { type: "takePile" });
    expect(took.ok).toBe(true);
    if (!took.ok) return;
    expect(applyAction(took.state, { type: "playMelds", melds: f.plan! }).ok).toBe(true);
  });

  it("brings the pile card in with a wild when already down, with no minimum to meet", () => {
    const two = card("2", "hearts");
    const s = state({ isDown: true, hand: [card("K"), two] }, [card("K")]);
    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true);
    expect(f.plan?.[0]?.cardIds).toContain(two.id);
  });

  it("adds wilds to a natural meld to make up the total", () => {
    // Three kings are 30; one two makes 50, still short, so the second goes on too
    // for 70. East Coast allows two wilds on three naturals.
    const twos = cards("2", 2);
    const s = state({ hand: [...cards("K", 2), ...twos] }, [card("K")]);
    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true);
    expect(f.plan?.[0]?.cardIds).toEqual(expect.arrayContaining(twos.map((c) => c.id)));
  });

  it("spends only the wilds the minimum needs, most valuable first", () => {
    const joker = card("JOKER");
    const two = card("2");
    const s = state({ hand: [...cards("K", 2), two, joker, card("9"), card("9")] }, [card("K")]);
    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true);
    const played = f.plan!.flatMap((play) => play.cardIds);
    // K K K + joker = 80 clears 60; the two is kept.
    expect(played).toContain(joker.id);
    expect(played).not.toContain(two.id);
  });

  it("respects the table's wild ratio", () => {
    // A pair of kings needs both twos to reach 60 — two naturals and two wilds,
    // which West Coast allows and East Coast, where naturals must outnumber wilds,
    // does not.
    const s = state({ hand: [card("K"), ...cards("2", 2)] }, [card("K")]);
    expect(canTakePile(s, 0).feasible).toBe(false);
    const west = canTakePile({ ...s, config: WEST_COAST }, 0);
    expect(west.feasible).toBe(true);
    expect(west.plan![0]!.cardIds).toHaveLength(4);
  });

  it("puts a wild where it adds the most, not merely where it fits first", () => {
    // Three nines are 15. The two on the nines makes 35, short of 60 with nothing
    // left; the two with the pair of aces makes 15 + 30 + 20 = 65.
    const s = state({ hand: [...cards("9", 2), ...cards("A", 2), card("2")] }, [card("9")]);
    const f = canTakePile(s, 0);
    expect(f.feasible).toBe(true);
    expect(f.plan!.map((play) => play.rank).sort()).toEqual(["9", "A"]);
  });

  it("chooses the meld a wild completes into a book over one it merely joins", () => {
    // Nines sort first, so a wild placed wherever it first fits goes on the nines
    // for 125. On the six kings it completes a dirty book: 60 + 15 + 50 + 300 = 425.
    const high = { ...EAST_COAST, layDownMinimums: [400] };
    const hand = [...cards("K", 5), ...cards("9", 3), card("JOKER")];
    const s = { ...state({ hand }, [card("K")]), config: high };
    expect(canTakePile(s, 0).feasible).toBe(true);
  });

  it("counts the dirty book a wild completes toward the minimum", () => {
    // Six kings and a joker: 60 + 50 = 110 in cards, and the dirty book bonus on
    // top is what clears a 400 minimum.
    const high = { ...EAST_COAST, layDownMinimums: [400] };
    const s = { ...state({ hand: [...cards("K", 5), card("JOKER")] }, [card("K")]), config: high };
    expect(canTakePile(s, 0).feasible).toBe(true);
  });

  it("still refuses when even every wild cannot reach the minimum", () => {
    // Three fours and a two: 15 + 20 = 35 < 60, with nowhere else to spend.
    const s = state({ hand: [...cards("4", 2), card("2")] }, [card("4")]);
    expect(canTakePile(s, 0).feasible).toBe(false);
  });

  it("will not make a meld of one natural and wilds", () => {
    // Under either ratio a single natural cannot carry two wilds.
    const s = state({ isDown: true, hand: cards("JOKER", 2) }, [card("K")]);
    expect(canTakePile(s, 0).feasible).toBe(false);
  });

  it("reaches the same answer whatever order the cards arrive in", () => {
    const hand = [card("Q"), card("JOKER"), card("7"), card("Q"), card("2"), card("9")];
    const pile = [card("Q")];
    const forward = canTakePile(state({ hand }, pile), 0);
    const backward = canTakePile(state({ hand: [...hand].reverse() }, pile), 0);
    expect(backward).toEqual(forward);
  });
});
