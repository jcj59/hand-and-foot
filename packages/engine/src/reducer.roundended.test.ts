import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Action,
  type Card,
  type GameState,
  type Meld,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `re${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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
  return { hand: [], foot: [], melds: [], isDown: true, inFoot: true, footPending: false, ...over };
}
function table(players: PlayerState[], over: Partial<GameState> = {}): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "draw",
    stock: cards("9", 5),
    discard: [card("8")],
    ...over,
  };
}

/** One of each action type, so the reducer's guard is checked on every branch. */
function everyAction(cardId: string): Action[] {
  return [
    { type: "draw" },
    { type: "takePile" },
    { type: "playMelds", melds: [{ rank: "K", cardIds: [cardId] }] },
    { type: "discard", cardId },
  ];
}

describe("no action is accepted once the round has ended", () => {
  it("rejects every action type on a round that has ended", () => {
    const five = card("5");
    const s = table([player({ foot: [five], melds: [cleanBook("K")] }), player({})], {
      roundEnded: true,
      wentOutSeat: 1,
    });
    for (const action of everyAction(five.id)) {
      const r = applyAction(s, action);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatch(/already ended/);
    }
  });

  it("rejects the same actions in the play phase, not just the draw phase", () => {
    const five = card("5");
    const s = table([player({ foot: [five] }), player({})], {
      phase: "play",
      roundEnded: true,
      wentOutSeat: 1,
    });
    for (const action of everyAction(five.id)) {
      expect(applyAction(s, action).ok).toBe(false);
    }
  });

  // Reached by real play rather than constructed: seat 0 goes out with a discard,
  // then any further action — including its own — is refused.
  it("refuses further play after a real go-out ends the round", () => {
    const five = card("5");
    const spare = card("6");
    const p0 = player({
      foot: [five],
      melds: [cleanBook("K"), dirtyBook("Q"), dirtyBook("J")],
    });
    const p1 = player({ inFoot: false, isDown: false, hand: [spare] });
    const out = applyAction(table([p0, p1], { phase: "play" }), {
      type: "discard",
      cardId: five.id,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.roundEnded).toBe(true);

    for (const action of everyAction(spare.id)) {
      const r = applyAction(out.state, action);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatch(/already ended/);
    }
  });

  it("leaves the ended state untouched, so scoring cannot drift", () => {
    const five = card("5");
    const s = table([player({ foot: [five] }), player({})], { roundEnded: true });
    const before = JSON.stringify(s);
    for (const action of everyAction(five.id)) applyAction(s, action);
    expect(JSON.stringify(s)).toBe(before);
  });
});
