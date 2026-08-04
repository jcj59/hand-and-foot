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
import { legalHints } from "./legal";
import { applyAction } from "./reducer";
import { canTakePile } from "./feasibility";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `lh${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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
function table(p0: PlayerState, over: Partial<GameState>): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, player({ isDown: false })],
    currentSeat: 0,
    phase: "play",
    stock: [],
    discard: [],
    ...over,
  };
}

describe("legalHints", () => {
  it("offers a draw and matches take-pile feasibility in the draw phase", () => {
    const s = table(player({ isDown: true, hand: cards("K", 2) }), {
      phase: "draw",
      discard: [card("K")],
    });
    const h = legalHints(s, 0);
    expect(h.canDraw).toBe(true);
    expect(h.canTakePile).toBe(canTakePile(s, 0).feasible);
    expect(h.canTakePile).toBe(true);
  });

  it("reports meldable ranks that the reducer then accepts (down player)", () => {
    const hand = [...cards("K", 3), ...cards("Q", 3), card("9")];
    const s = table(player({ isDown: true, hand }), { phase: "play" });
    const h = legalHints(s, 0);
    expect([...h.meldableRanks].sort()).toEqual(["K", "Q"]);
    for (const rank of h.meldableRanks) {
      const ids = hand.filter((c) => c.rank === rank).map((c) => c.id);
      const r = applyAction(s, { type: "playMelds", melds: [{ rank, cardIds: ids }] });
      expect(r.ok).toBe(true);
    }
  });

  it("reports canGoOut according to the go-out rule", () => {
    const p = player({
      isDown: true,
      inFoot: true,
      foot: [card("5")],
      melds: [cleanBook("K"), dirtyBook("Q"), dirtyBook("J")],
    });
    expect(legalHints(table(p, { phase: "play" }), 0).canGoOut).toBe(true);
  });

  it("offers nothing when it is not the seat's turn", () => {
    const h = legalHints(table(player({ isDown: true }), { phase: "play" }), 1);
    expect(h.canDraw).toBe(false);
    expect(h.meldableRanks).toEqual([]);
  });

  it("offers nothing once the round has ended", () => {
    const s = table(player({ isDown: true, hand: cards("K", 3) }), {
      phase: "play",
      roundEnded: true,
    });
    const h = legalHints(s, 0);
    expect(h.canDraw).toBe(false);
    expect(h.canTakePile).toBe(false);
    expect(h.meldableRanks).toEqual([]);
    expect(h.canGoOut).toBe(false);
  });

  it("reports no meldable ranks during the draw phase, before anything is drawn", () => {
    const s = table(player({ isDown: true, hand: cards("K", 3) }), { phase: "draw" });
    const h = legalHints(s, 0);
    expect(h.meldableRanks).toEqual([]);
    expect(h.canGoOut).toBe(false);
  });

  it("never reports wilds or threes as meldable ranks", () => {
    const hand = [
      ...cards("2", 3),
      ...cards("JOKER", 3),
      card("3", "hearts"),
      card("3", "hearts"),
      card("3", "hearts"),
      card("3", "clubs"),
      card("3", "clubs"),
      card("3", "clubs"),
    ];
    const s = table(player({ isDown: true, hand }), { phase: "play" });
    expect(legalHints(s, 0).meldableRanks).toEqual([]);
  });

  it("reports a rank held only once when the player already melds it", () => {
    const s = table(
      player({
        isDown: true,
        melds: [{ rank: "7", cards: cards("7", 3) }],
        hand: [card("7")],
      }),
      { phase: "play" },
    );
    expect(legalHints(s, 0).meldableRanks).toEqual(["7"]);

    // Without the existing meld a single card is not enough.
    const alone = table(player({ isDown: true, hand: [card("7")] }), { phase: "play" });
    expect(legalHints(alone, 0).meldableRanks).toEqual([]);
  });

  // A new meld needs three naturals, so a pair must not be offered: the hint would
  // point at a play the reducer goes on to reject.
  it("does not report a pair as a new meldable rank", () => {
    const s = table(player({ isDown: true, hand: cards("7", 2) }), { phase: "play" });
    expect(legalHints(s, 0).meldableRanks).toEqual([]);

    // The third card is what makes it meldable, and the reducer agrees.
    const three = cards("7", 3);
    const s3 = table(player({ isDown: true, hand: three }), { phase: "play" });
    expect(legalHints(s3, 0).meldableRanks).toEqual(["7"]);
    expect(
      applyAction(s3, {
        type: "playMelds",
        melds: [{ rank: "7", cardIds: three.map((c) => c.id) }],
      }).ok,
    ).toBe(true);
  });

  // A player owing a foot pickup must draw their foot, not the pile, so offering
  // the pile here would contradict what `applyTakePile` accepts.
  it("does not offer the pile to a player who owes a foot pickup", () => {
    const hints = (footPending: boolean) =>
      legalHints(
        table(player({ isDown: true, footPending, hand: cards("K", 2), foot: cards("5", 3) }), {
          phase: "draw",
          discard: [card("K")],
        }),
        0,
      );

    // Same position but for the pending foot: the pile is otherwise takeable.
    expect(hints(false).canTakePile).toBe(true);
    expect(hints(true).canTakePile).toBe(false);

    // And the reducer rejects the take, which is what the hint is promising.
    const pending = table(
      player({ isDown: true, footPending: true, hand: cards("K", 2), foot: cards("5", 3) }),
      { phase: "draw", discard: [card("K")] },
    );
    const r = applyAction(pending, { type: "takePile" });
    expect(r.ok).toBe(false);
  });

  it("reports a black-three book only from the foot, and only at seven", () => {
    const seven = table(player({ isDown: true, inFoot: true, foot: cards("3", 7) }), {
      phase: "play",
    });
    expect(legalHints(seven, 0).meldableRanks).toContain("3");

    const six = table(player({ isDown: true, inFoot: true, foot: cards("3", 6) }), {
      phase: "play",
    });
    expect(legalHints(six, 0).meldableRanks).not.toContain("3");

    const fromHand = table(player({ isDown: true, hand: cards("3", 7) }), { phase: "play" });
    expect(legalHints(fromHand, 0).meldableRanks).not.toContain("3");
  });
});
