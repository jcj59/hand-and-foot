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
import { deal } from "./deal";
import { project } from "./view";
import { buildShoe } from "./deck";

const meldCardCount = (melds: readonly Meld[]) =>
  melds.reduce((total, meld) => total + meld.cards.length, 0);

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `vw${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function player(over: Partial<PlayerState> = {}): PlayerState {
  return {
    hand: [],
    foot: [],
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
    ...over,
  };
}
function table(players: PlayerState[]): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "play",
    stock: cards("9", 4),
    discard: [card("8")],
  };
}

describe("project (per-player view)", () => {
  const state = deal(4, EAST_COAST, 55);
  const view = project(state, 0);

  it("shows the viewer their own hand in full", () => {
    expect(view.hand).toEqual(state.players[0].hand);
  });

  it("reduces every opponent to counts", () => {
    expect(view.opponents).toHaveLength(3);
    for (const opp of view.opponents) {
      expect(opp.handCount).toBe(14);
      expect(opp.footCount).toBe(14);
    }
  });

  it("never leaks another player's hidden cards (L6 view-security)", () => {
    const serialized = JSON.stringify(view);
    const foreignIds = state.players
      .slice(1)
      .flatMap((p) => [...p.hand, ...p.foot].map((c) => c.id));
    for (const id of foreignIds) {
      expect(serialized).not.toContain(id);
    }
  });

  it("hides the viewer's own foot until it is picked up", () => {
    expect(view.inFoot).toBe(false);
    expect(view.foot).toBeNull();
    expect(view.footCount).toBe(14);
  });

  it("exposes the stock as a count and the discard in full", () => {
    expect(typeof view.stockCount).toBe("number");
    expect("stock" in view).toBe(false);
    expect(view.discard).toEqual(state.discard);
  });

  it("accounts for every card in the shoe", () => {
    const total =
      view.hand.length +
      view.footCount +
      meldCardCount(view.melds) +
      view.opponents.reduce(
        (sum, opp) => sum + opp.handCount + opp.footCount + meldCardCount(opp.melds),
        0,
      ) +
      view.discard.length +
      view.stockCount;
    expect(total).toBe(buildShoe(4, EAST_COAST.extraDecks).length);
  });
});

describe("project once players are in their feet", () => {
  it("reveals the viewer's own foot after they pick it up", () => {
    const foot = cards("K", 3);
    const s = table([player({ inFoot: true, foot: [...foot] }), player()]);
    const v = project(s, 0);
    expect(v.inFoot).toBe(true);
    expect(v.foot).toEqual(foot);
    expect(v.footCount).toBe(3);
  });

  it("keeps an opponent's foot hidden even after they pick it up", () => {
    const oppFoot = cards("A", 5);
    const s = table([
      player({ hand: cards("K", 2) }),
      player({ inFoot: true, foot: [...oppFoot] }),
    ]);
    const v = project(s, 0);
    expect(v.opponents[0].inFoot).toBe(true);
    expect(v.opponents[0].footCount).toBe(5);
    const serialized = JSON.stringify(v);
    for (const c of oppFoot) expect(serialized).not.toContain(c.id);
  });

  it("does not leak hidden cards even when melds make some cards public", () => {
    const oppMeld: Meld = { rank: "Q", cards: cards("Q", 4) };
    const oppHidden = [...cards("A", 3), ...cards("7", 2)];
    const s = table([
      player({ hand: cards("K", 2), melds: [{ rank: "K", cards: cards("K", 3) }] }),
      player({ inFoot: true, foot: [...oppHidden], melds: [oppMeld] }),
    ]);
    const v = project(s, 0);
    // Melded cards are public and must be present.
    expect(v.opponents[0].melds).toEqual([oppMeld]);
    const serialized = JSON.stringify(v);
    for (const c of oppMeld.cards) expect(serialized).toContain(c.id);
    // Hidden cards must not be.
    for (const c of oppHidden) expect(serialized).not.toContain(c.id);
  });
});

describe("project from any seat", () => {
  it("lists the other seats in seat order with their counts", () => {
    const s = table([
      player({ hand: cards("K", 1) }),
      player({ hand: cards("Q", 2) }),
      player({ hand: cards("A", 3) }),
    ]);
    const v = project(s, 1);
    expect(v.seat).toBe(1);
    expect(v.hand).toHaveLength(2);
    expect(v.opponents.map((o) => o.seat)).toEqual([0, 2]);
    expect(v.opponents.map((o) => o.handCount)).toEqual([1, 3]);
  });

  it("passes public state through unchanged", () => {
    const s: GameState = {
      ...table([player({ isDown: true }), player()]),
      currentSeat: 1,
      phase: "draw",
      roundNumber: 1,
    };
    const v = project(s, 0);
    expect(v.currentSeat).toBe(1);
    expect(v.phase).toBe("draw");
    expect(v.roundNumber).toBe(1);
    expect(v.isDown).toBe(true);
    expect(v.stockCount).toBe(4);
    expect(v.discard).toEqual(s.discard);
  });

  it("tells every seat who went out and how much of the final lap is left", () => {
    // Public facts: the go-out happens in front of the whole table, and each
    // remaining player has to know that this turn is their last.
    const s: GameState = {
      ...table([player(), player(), player()]),
      wentOutSeat: 2,
      finalLapRemaining: 2,
    };
    for (const seat of [0, 1, 2]) {
      expect(project(s, seat).wentOutSeat).toBe(2);
      expect(project(s, seat).finalLapRemaining).toBe(2);
    }
  });

  it("says plainly when nobody has gone out and no final lap is running", () => {
    const s = table([player(), player()]);
    expect(project(s, 0).wentOutSeat).toBeNull();
    expect(project(s, 0).finalLapRemaining).toBeNull();
    // A lap run down to zero is over, not running.
    expect(project({ ...s, finalLapRemaining: 0 }, 0).finalLapRemaining).toBeNull();
  });
});

describe("the take-pile obligation in a view", () => {
  it("shows the viewer their own outstanding obligation", () => {
    // The client needs it to say why a discard is about to be refused, and which
    // cards in hand would settle it.
    const owed = card("7");
    const s = table([player({ hand: [owed], pickedUp: [owed.id] }), player()]);
    expect(project(s, 0).pickedUp).toEqual([owed.id]);
  });

  it("is an empty list rather than absent when nothing is owed", () => {
    // `pickedUp` is optional on PlayerState but always present in a view, so the
    // client never has to distinguish "no obligation" from "field missing".
    const s = table([player({ hand: [card("7")] }), player()]);
    expect(project(s, 0).pickedUp).toEqual([]);
  });

  it("never carries another seat's obligation", () => {
    // The decisive check: an opponent's owed ids would say which cards they just
    // took off the pile, which is theirs to know and not the viewer's. OpponentView
    // has no such field, so this asserts the projection keeps it that way.
    const mine = card("7");
    const theirs = card("9", "spades");
    const s = table([
      player({ hand: [mine], pickedUp: [mine.id] }),
      player({ hand: [theirs], pickedUp: [theirs.id] }),
    ]);

    const v = project(s, 0);
    expect(v.pickedUp).toEqual([mine.id]);
    expect(JSON.stringify(v)).not.toContain(theirs.id);
    for (const opponent of v.opponents) {
      expect(Object.prototype.hasOwnProperty.call(opponent, "pickedUp")).toBe(false);
    }
  });

  it("gives each seat only its own, from the same state", () => {
    const mine = card("7");
    const theirs = card("9", "spades");
    const s = table([
      player({ hand: [mine], pickedUp: [mine.id] }),
      player({ hand: [theirs], pickedUp: [theirs.id] }),
    ]);
    expect(project(s, 0).pickedUp).toEqual([mine.id]);
    expect(project(s, 1).pickedUp).toEqual([theirs.id]);
  });
});
