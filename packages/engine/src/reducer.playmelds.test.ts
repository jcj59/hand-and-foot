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
import { classifyBook } from "./scoring";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `p${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
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
function gs(p0: PlayerState): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, player({ isDown: false })],
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
  };
}

describe("playMelds (already down)", () => {
  it("lays a valid new meld and removes the cards from the hand", () => {
    const k = [card("K"), card("K"), card("K")];
    const s = gs(player({ hand: [...k, card("5")] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: k.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].melds).toHaveLength(1);
    expect(r.state.players[0].melds[0].cards).toHaveLength(3);
    expect(r.state.players[0].hand.map((c) => c.rank)).toEqual(["5"]);
  });

  it("extends the existing meld of a rank rather than making a second one", () => {
    const existing = [card("7"), card("7"), card("7")];
    const add = card("7");
    const wild = card("2");
    const s = gs(player({ melds: [{ rank: "7", cards: existing }], hand: [add, wild] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "7", cardIds: [add.id, wild.id] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].melds).toHaveLength(1);
    expect(r.state.players[0].melds[0].cards).toHaveLength(5);
  });

  it("rejects the whole submission if any meld is invalid, leaving state unchanged", () => {
    const good = [card("Q"), card("Q"), card("Q")];
    const bad = [card("9"), card("9")]; // only two cards
    const s = gs(player({ hand: [...good, ...bad] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [
        { rank: "Q", cardIds: good.map((c) => c.id) },
        { rank: "9", cardIds: bad.map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects playing a card that is not in the active zone", () => {
    const s = gs(player({ hand: [card("K"), card("K")] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: ["nope-1", "nope-2", "nope-3"] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects melds outside the play phase", () => {
    const k = cards("K", 3);
    const s: GameState = { ...gs(player({ hand: [...k] })), phase: "draw" };
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: k.map((c) => c.id) }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/play phase/);
  });

  it("rejects an empty submission", () => {
    const r = applyAction(gs(player({ hand: cards("K", 3) })), { type: "playMelds", melds: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no melds were submitted/);
  });

  it("rejects a meld whose declared rank does not match its natural cards", () => {
    const k = cards("K", 3);
    const r = applyAction(gs(player({ hand: [...k] })), {
      type: "playMelds",
      melds: [{ rank: "Q", cardIds: k.map((c) => c.id) }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/declared as rank Q/);
    expect(r.error).toMatch(/are K/);
  });

  it("rejects using the same card in two melds of one submission", () => {
    const k = cards("K", 3);
    const q = cards("Q", 2);
    const s = gs(player({ hand: [...k, ...q] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [
        { rank: "K", cardIds: k.map((c) => c.id) },
        // Reuses a king already consumed by the first meld.
        { rank: "Q", cardIds: [...q.map((c) => c.id), k[0].id] },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not available to play/);
  });

  it("merges two plays of the same rank into that rank's single meld", () => {
    const first = cards("K", 3);
    const extra = card("K");
    const s = gs(player({ hand: [...first, extra] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [
        { rank: "K", cardIds: first.map((c) => c.id) },
        { rank: "K", cardIds: [extra.id] },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].melds).toHaveLength(1);
    expect(r.state.players[0].melds[0].cards).toHaveLength(4);
  });

  it("completes a book by extending an existing meld to seven", () => {
    const existing = cards("K", 6);
    const seventh = card("K");
    const s = gs(player({ melds: [{ rank: "K", cards: existing }], hand: [seventh, card("5")] }));
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "K", cardIds: [seventh.id] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meld = r.state.players[0].melds.find((m) => m.rank === "K");
    expect(meld?.cards).toHaveLength(7);
    expect(classifyBook(meld!)).toBe("clean");
  });

  it("leaves the submitted state untouched when a meld is rejected", () => {
    const good = cards("Q", 3);
    const bad = cards("9", 2);
    const s = gs(player({ hand: [...good, ...bad] }));
    const before = JSON.stringify(s);
    const r = applyAction(s, {
      type: "playMelds",
      melds: [
        { rank: "Q", cardIds: good.map((c) => c.id) },
        { rank: "9", cardIds: bad.map((c) => c.id) },
      ],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
});
