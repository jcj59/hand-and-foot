import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Action,
  type Card,
  type GameState,
  type Meld,
  type PlayerState,
  type Rank,
  type RulesConfig,
  type Suit,
} from "@hf/shared";
import { MAX_PILE_RED_THREES, heuristicAction } from "./policy";
import { applyAction } from "./reducer";
import { project } from "./view";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `h${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function meld(rank: Rank, naturals: number, wilds = 0): Meld {
  return { rank, cards: [...cards(rank, naturals), ...cards("2", wilds)] };
}
function seat(over: Partial<PlayerState>): PlayerState {
  return {
    hand: [],
    foot: cards("8", 3),
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
    ...over,
  };
}
function table(p0: PlayerState, over: Partial<GameState> = {}): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, seat({ hand: cards("6", 4) })],
    currentSeat: 0,
    phase: "play",
    stock: cards("7", 5),
    discard: [card("10")],
    ...over,
  };
}

/** What the heuristic chooses for the seat on turn, from that seat's own view. */
function choose(state: GameState): Action | null {
  return heuristicAction(project(state, state.currentSeat), state.config);
}

/** Choose and apply one move through the reducer, which must accept it. */
function step(state: GameState): { action: Action; state: GameState } {
  const action = choose(state);
  expect(action, "the heuristic proposed nothing on its own turn").not.toBeNull();
  const r = applyAction(state, action!);
  expect(r.ok, r.ok ? "" : `refused ${JSON.stringify(action)}: ${r.error}`).toBe(true);
  return { action: action!, state: (r as { state: GameState }).state };
}

/** Play the seat's whole turn, returning every move it made. */
function turn(start: GameState): { actions: Action[]; state: GameState } {
  const actions: Action[] = [];
  let state = start;
  do {
    const next = step(state);
    actions.push(next.action);
    state = next.state;
  } while (state.currentSeat === start.currentSeat && !state.roundEnded && actions.length < 20);
  return { actions, state };
}

/** The heuristic discards this turn, and not `kept`. */
function expectDiscardKeeping(state: GameState, kept: Card): void {
  const action = choose(state);
  expect(action?.type).toBe("discard");
  expect((action as { cardId: string }).cardId).not.toBe(kept.id);
}
const kinds = (actions: readonly Action[]): string[] => actions.map((a) => a.type);

describe("heuristicAction — whose turn", () => {
  it("proposes nothing for a seat that is not on turn", () => {
    const state = table(seat({ hand: cards("K", 3) }));
    expect(heuristicAction(project(state, 1), state.config)).toBeNull();
  });
});

describe("heuristicAction — draw or take the pile", () => {
  it("draws when no pile card is playable", () => {
    const state = table(seat({ hand: [card("K"), card("Q"), card("5")] }), {
      phase: "draw",
      discard: [card("9")],
    });
    expect(choose(state)).toEqual({ type: "draw" });
  });

  it("draws when the pile would make a meld but not the minimum", () => {
    // Q Q + the pile's Q is a meld worth 30, short of round 1's 60.
    const state = table(seat({ hand: [...cards("Q", 2), card("5")] }), {
      phase: "draw",
      discard: [card("Q")],
    });
    expect(choose(state)).toEqual({ type: "draw" });
  });

  it("takes a pile that extends a meld, settles it, and discards", () => {
    const state = table(
      seat({ isDown: true, melds: [meld("K", 3)], hand: [card("5"), card("9"), card("4")] }),
      { phase: "draw", discard: [card("8"), card("K")] },
    );
    const { actions, state: after } = turn(state);
    expect(kinds(actions)).toEqual(["takePile", "playMelds", "discard"]);
    expect(after.players[0].melds.find((m) => m.rank === "K")!.cards).toHaveLength(4);
    expect(after.currentSeat).toBe(1);
  });

  it("takes the pile to get down when the pile completes the minimum", () => {
    // K K K (30) and Q Q + the pile's Q (30) reach 60 only with the pile.
    const state = table(seat({ hand: [...cards("K", 3), ...cards("Q", 2), card("4")] }), {
      phase: "draw",
      discard: [card("Q")],
    });
    const { actions, state: after } = turn(state);
    expect(kinds(actions)).toEqual(["takePile", "playMelds", "discard"]);
    expect(after.players[0].isDown).toBe(true);
  });

  it("declines a usable pile holding more red threes than it can shed", () => {
    const reds = (n: number): Card[] =>
      Array.from({ length: n }, (_, i) => card("3", i % 2 ? "hearts" : "diamonds"));
    const withReds = (n: number): GameState =>
      table(seat({ isDown: true, melds: [meld("K", 3)], hand: [card("5")] }), {
        phase: "draw",
        discard: [...reds(n), card("K")],
      });
    expect(choose(withReds(MAX_PILE_RED_THREES))).toEqual({ type: "takePile" });
    expect(choose(withReds(MAX_PILE_RED_THREES + 1))).toEqual({ type: "draw" });
  });

  it("allows two red threes in a pile it takes — a limit chosen by measurement", () => {
    expect(MAX_PILE_RED_THREES).toBe(2);
  });
});

describe("heuristicAction — getting down", () => {
  it("gets down as soon as a lay-down reaches the minimum, then discards", () => {
    const hand = [...cards("K", 3), ...cards("Q", 3), card("5")];
    const { actions, state } = turn(table(seat({ hand })));
    expect(kinds(actions)).toEqual(["playMelds", "discard"]);
    expect(state.players[0].isDown).toBe(true);
    expect(state.discard.at(-1)!.rank).toBe("5");
  });

  it("holds its melds back while they fall short of the minimum", () => {
    // K K K and 5 5 5 are 45, short of 60.
    const hand = [...cards("K", 3), ...cards("5", 3), card("9"), card("4")];
    const { actions, state } = turn(table(seat({ hand })));
    expect(kinds(actions)).toEqual(["discard"]);
    expect(state.players[0].isDown).toBe(false);
  });

  it("melds the whole hand below the minimum under the Marva rule, into the foot", () => {
    const hand = [...cards("K", 3), ...cards("5", 3)]; // 45 < 60, but it is everything
    const { action, state } = step(table(seat({ hand })));
    expect(action.type).toBe("playMelds");
    expect(state.players[0].isDown).toBe(true);
    expect(state.players[0].inFoot).toBe(true);
  });

  it("does not try the Marva rule when the table plays without it", () => {
    const hand = [...cards("K", 3), ...cards("5", 3)];
    const config: RulesConfig = { ...EAST_COAST, marvaRule: false };
    expect(choose(table(seat({ hand }), { config }))?.type).toBe("discard");
  });

  it("does not try the Marva rule when a card would be left over", () => {
    const hand = [...cards("K", 3), ...cards("5", 3), card("9")];
    expect(choose(table(seat({ hand })))?.type).toBe("discard");
  });

  it("does not try the Marva rule from the foot, which it does not cover", () => {
    const foot = [...cards("K", 3), ...cards("5", 3)];
    expect(choose(table(seat({ foot, inFoot: true })))?.type).toBe("discard");
  });

  it("gets down with any meld in a round that sets no minimum", () => {
    const config: RulesConfig = { ...EAST_COAST, layDownMinimums: [] };
    const { action } = step(table(seat({ hand: [...cards("5", 3), card("9")] }), { config }));
    expect(action).toEqual({
      type: "playMelds",
      melds: [{ rank: "5", cardIds: expect.any(Array) }],
    });
  });

  it("discards when a round with no minimum still offers nothing to meld", () => {
    const config: RulesConfig = { ...EAST_COAST, layDownMinimums: [] };
    expect(choose(table(seat({ hand: [card("9"), card("4")] }), { config }))?.type).toBe("discard");
  });
});

describe("heuristicAction — once down", () => {
  it("lays every natural that extends a meld or opens one, then discards", () => {
    const hand = [card("K"), ...cards("Q", 3), card("9")];
    const state = table(seat({ isDown: true, melds: [meld("K", 3)], hand }));
    const { actions, state: after } = turn(state);
    expect(kinds(actions)).toEqual(["playMelds", "discard"]);
    expect(after.players[0].melds.map((m) => [m.rank, m.cards.length])).toEqual([
      ["K", 4],
      ["Q", 3],
    ]);
    expect(after.discard.at(-1)!.rank).toBe("9");
  });

  it("throws a red three before anything else", () => {
    const hand = [card("3", "hearts"), ...cards("9", 2), card("4")];
    const { action } = step(table(seat({ isDown: true, melds: [meld("K", 3)], hand })));
    expect(action).toEqual({ type: "discard", cardId: hand[0].id });
  });

  it("spends a wild from the hand to complete a book", () => {
    const joker = card("JOKER");
    const state = table(
      seat({
        isDown: true,
        melds: [meld("K", 7), meld("Q", 5, 1)],
        hand: [joker, card("9"), card("4")],
      }),
    );
    const { action, state: after } = step(state);
    expect(action).toEqual({ type: "playMelds", melds: [{ rank: "Q", cardIds: [joker.id] }] });
    expect(after.players[0].melds.find((m) => m.rank === "Q")!.cards).toHaveLength(7);
  });

  it("completes a book with a joker before a two, since a held joker costs more", () => {
    const two = card("2");
    const joker = card("JOKER");
    const state = table(
      seat({
        isDown: true,
        melds: [meld("K", 7), meld("Q", 5, 1)],
        hand: [two, joker, card("9")],
      }),
    );
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: [joker.id] }],
    });
  });

  it("keeps a wild in the hand when it cannot complete a book", () => {
    const wild = card("2");
    const state = table(
      seat({ isDown: true, melds: [meld("K", 7), meld("Q", 4, 1)], hand: [wild, card("9")] }),
    );
    expectDiscardKeeping(state, wild);
  });

  it("does not complete a book with more wilds than the ratio allows", () => {
    // Q Q Q + one wild needs three more to make seven: four wilds to three naturals.
    const hand = [...cards("2", 2), card("JOKER"), card("9")];
    const state = table(seat({ isDown: true, melds: [meld("K", 7), meld("Q", 3, 1)], hand }));
    expect(choose(state)).toEqual({ type: "discard", cardId: hand[3].id });
  });

  it("does not dirty its best clean meld while it still owes a clean book", () => {
    const wild = card("2");
    const state = table(
      seat({ isDown: true, inFoot: true, melds: [meld("Q", 6)], foot: [wild, card("9")] }),
    );
    expectDiscardKeeping(state, wild);
  });

  it("guards the clean meld nearest a book, and spends the wild on another", () => {
    const wild = card("2");
    const state = table(
      seat({
        isDown: true,
        inFoot: true,
        melds: [meld("J", 4), meld("Q", 6), meld("5", 3)],
        foot: [wild, card("9")],
      }),
    );
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "J", cardIds: [wild.id] }],
    });
  });

  it("guards only a clean meld: a bigger meld with a wild in it is no prospect", () => {
    const wild = card("2");
    const state = table(
      seat({
        isDown: true,
        inFoot: true,
        melds: [meld("J", 4), meld("Q", 5, 1)],
        foot: [wild, card("9")],
      }),
    );
    // J is the clean meld kept clean; the dirty Q is a wild from a book.
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: [wild.id] }],
    });
  });

  it("guards an unfinished clean meld, not a clean book already made", () => {
    // A table that wants two clean books to go out, with one down.
    const config: RulesConfig = { ...EAST_COAST, goOutCleanBooks: 2 };
    const wild = card("2");
    const state = table(
      seat({
        isDown: true,
        inFoot: true,
        melds: [meld("K", 7), meld("Q", 4)],
        foot: [wild, card("9")],
      }),
      { config },
    );
    expectDiscardKeeping(state, wild);
  });

  it("completes that meld with a wild once a clean book is already down", () => {
    const wild = card("2");
    const state = table(
      seat({
        isDown: true,
        inFoot: true,
        melds: [meld("K", 7), meld("Q", 6)],
        foot: [wild, card("9")],
      }),
    );
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: [wild.id] }],
    });
  });

  it("never puts a wild on its only clean book", () => {
    const wild = card("2");
    const state = table(
      seat({ isDown: true, inFoot: true, melds: [meld("K", 7)], foot: [wild, card("9")] }),
    );
    expectDiscardKeeping(state, wild);
  });

  it("dirties a spare clean book when a dirty book is missing", () => {
    const wild = card("2");
    const state = table(
      seat({
        isDown: true,
        inFoot: true,
        melds: [meld("K", 7), meld("Q", 8), meld("J", 5)],
        foot: [wild, card("9")],
      }),
    );
    // The bigger clean book takes it, ahead of the unfinished J meld.
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: [wild.id] }],
    });
  });

  it("leaves spare clean books alone once the dirty books are in", () => {
    const wild = card("2");
    const state = table(
      seat({
        isDown: true,
        inFoot: true,
        melds: [meld("K", 7), meld("Q", 8), meld("5", 6, 1), meld("6", 6, 1)],
        foot: [wild, card("9"), card("4")],
      }),
    );
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "5", cardIds: [wild.id] }],
    });
  });

  it("from the foot, spends a spare wild on an unfinished meld before a dirty book", () => {
    const joker = card("JOKER");
    const state = table(
      seat({
        isDown: true,
        inFoot: true,
        melds: [meld("K", 7), meld("Q", 4), meld("J", 6, 1)],
        foot: [joker, card("9"), card("4")],
      }),
    );
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: [joker.id] }],
    });
  });

  it("from the hand, keeps that same wild for later", () => {
    const joker = card("JOKER");
    const state = table(
      seat({
        isDown: true,
        melds: [meld("K", 7), meld("Q", 4), meld("J", 6, 1)],
        hand: [joker, card("9"), card("4")],
      }),
    );
    expect(choose(state)?.type).toBe("discard");
  });

  it("adds a wild alongside naturals of the same rank in one play", () => {
    const wild = card("2");
    const q = card("Q");
    const state = table(
      seat({
        isDown: true,
        melds: [meld("K", 7), meld("Q", 4, 1)],
        hand: [q, wild, card("9")],
      }),
    );
    expect(choose(state)).toEqual({
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: [q.id, wild.id] }],
    });
  });
});

describe("heuristicAction — going out", () => {
  const books = (): Meld[] => [meld("K", 7), meld("Q", 6, 1), meld("J", 6, 1)];

  it("goes out by discarding its last card once the books are in", () => {
    const state = table(seat({ isDown: true, inFoot: true, melds: books(), foot: [card("9")] }));
    const { state: after } = step(state);
    expect(after.roundEnded).toBe(true);
    expect(after.wentOutSeat).toBe(0);
  });

  it("goes out by melding its last card once the books are in", () => {
    const state = table(seat({ isDown: true, inFoot: true, melds: books(), foot: [card("K")] }));
    const { action, state: after } = step(state);
    expect(action.type).toBe("playMelds");
    expect(after.wentOutSeat).toBe(0);
  });

  it("settles a pile it took from the foot before going on", () => {
    const pile = [card("9"), card("K")];
    const state = table(
      seat({ isDown: true, inFoot: true, melds: [meld("K", 3)], foot: [card("5")] }),
      { phase: "draw", discard: pile },
    );
    const { actions, state: after } = turn(state);
    expect(kinds(actions)).toEqual(["takePile", "playMelds", "discard"]);
    expect(after.players[0].melds[0].cards).toHaveLength(4);
  });
});

describe("the heuristic with black threes in its foot", () => {
  const threes = (n: number): Card[] =>
    Array.from({ length: n }, (_, i) => card("3", i % 2 ? "spades" : "clubs"));

  it("melds seven of them as a book, the only way to stop them costing points", () => {
    const book = threes(7);
    const s = table(seat({ isDown: true, inFoot: true, foot: [...book, card("9"), card("K")] }));
    const { action } = step(s);
    expect(action).toEqual({
      type: "playMelds",
      melds: [{ rank: "3", cardIds: expect.arrayContaining(book.map((c) => c.id)) }],
    });
  });

  it("gets down with them, when it reached the foot by discarding before it was down", () => {
    const book = threes(7);
    const s = table(seat({ inFoot: true, foot: [...book, card("9"), card("K")] }));
    const { action, state } = step(s);
    expect(action.type).toBe("playMelds");
    expect(state.players[0].isDown).toBe(true);
    expect(state.players[0].melds.map((m) => m.rank)).toEqual(["3"]);
  });

  it("keeps six, which cannot be melded", () => {
    const s = table(
      seat({ isDown: true, inFoot: true, foot: [...threes(6), card("9"), card("K")] }),
    );
    expect(choose(s)?.type).toBe("discard");
  });

  it("never melds them from the hand", () => {
    const s = table(seat({ isDown: true, hand: [...threes(7), card("9"), card("K")] }));
    expect(choose(s)?.type).toBe("discard");
  });
});
