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
import { legalHints } from "./legal";
import { scoreRound } from "./scoreRound";
import { canGoOut } from "./goout";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `cl${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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
/** Six cards (five naturals and a wild): one card short of a dirty book. */
function nearBook(rank: Rank): Meld {
  return { rank, cards: [...cards(rank, 5), card("2")] };
}

/**
 * A player who has shed every card. They must be down to have got here — the only
 * way to empty a zone is by melding — so they are always down and in their foot.
 */
function cardless(melds: Meld[]): PlayerState {
  return { hand: [], foot: [], melds, isDown: true, inFoot: true, footPending: false };
}
function tableOf(players: PlayerState[], over: Partial<GameState> = {}): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "draw",
    stock: cards("9", 10),
    discard: [card("8")],
    ...over,
  };
}
const idle: PlayerState = {
  hand: [card("6")],
  foot: [],
  melds: [],
  isDown: false,
  inFoot: false,
  footPending: false,
};

describe("a player holding no cards keeps playing", () => {
  it("offers both a draw and the pile when the pile is takeable", () => {
    // The pile holds a J, and this player already has a J meld to extend.
    const s = tableOf([cardless([cleanBook("K"), nearBook("J")]), idle], {
      discard: [card("J"), card("8")],
    });
    const hints = legalHints(s, 0);
    expect(hints.canDraw).toBe(true);
    expect(hints.canTakePile).toBe(true);
  });

  it("draws from the stock into the empty foot", () => {
    const s = tableOf([cardless([cleanBook("K")]), idle]);
    const r = applyAction(s, { type: "draw" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].foot).toHaveLength(1);
    expect(r.state.players[0].inFoot).toBe(true);
    expect(r.state.phase).toBe("play");
    expect(r.state.stock).toHaveLength(9);
  });

  it("takes the whole pile into the empty foot, owing a play from it", () => {
    const pile = [card("J"), card("8")];
    const s = tableOf([cardless([cleanBook("K"), nearBook("J")]), idle], { discard: [...pile] });
    const r = applyAction(s, { type: "takePile" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].foot.map((c) => c.id)).toEqual(pile.map((c) => c.id));
    expect(r.state.players[0].pickedUp).toEqual(pile.map((c) => c.id));
    expect(r.state.discard).toHaveLength(0);
    expect(r.state.phase).toBe("play");
  });

  it("cannot take a pile that forms nothing, and still has the draw", () => {
    // Nothing in the pile extends the K book and there is no natural triple.
    const s = tableOf([cardless([cleanBook("K")]), idle], { discard: [card("8"), card("9")] });
    expect(applyAction(s, { type: "takePile" }).ok).toBe(false);
    expect(legalHints(s, 0).canTakePile).toBe(false);
    expect(applyAction(s, { type: "draw" }).ok).toBe(true);
  });

  it("takes the pile, completes the last book, and goes out from nothing", () => {
    // One clean and one dirty book, plus a J meld one card short of a second dirty
    // book: not enough to go out yet.
    const p0 = cardless([cleanBook("K"), dirtyBook("Q"), nearBook("J")]);
    expect(canGoOut(p0, EAST_COAST)).toBe(false);

    const jack = card("J");
    const eight = card("8");
    const s = tableOf([p0, idle], { discard: [jack, eight] });

    const took = applyAction(s, { type: "takePile" });
    expect(took.ok).toBe(true);
    if (!took.ok) return;

    // Playing the picked-up J turns the near-book into a dirty book.
    const melded = applyAction(took.state, {
      type: "playMelds",
      melds: [{ rank: "J", cardIds: [jack.id] }],
    });
    expect(melded.ok).toBe(true);
    if (!melded.ok) return;
    expect(melded.state.players[0].melds.find((m) => m.rank === "J")?.cards).toHaveLength(7);
    expect(melded.state.players[0].pickedUp).toEqual([]);
    expect(canGoOut(melded.state.players[0], EAST_COAST)).toBe(true);

    // The rest of the pile is discarded, which now goes out for real.
    const out = applyAction(melded.state, { type: "discard", cardId: eight.id });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.roundEnded).toBe(true);
    expect(out.state.wentOutSeat).toBe(0);
    expect(scoreRound(out.state)[0].score).toBe(
      scoreRound({ ...out.state, wentOutSeat: undefined })[0].score + EAST_COAST.scoring.goOutBonus,
    );
  });

  it("sheds back to nothing without going out when the books are still short", () => {
    // Draw, meld the drawn card onto an existing meld, and end up empty again. The
    // books are incomplete, so this is not a go-out and the turn just ends.
    const s = tableOf([cardless([nearBook("9")]), idle]);
    const drawn = applyAction(s, { type: "draw" });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    const nine = drawn.state.players[0].foot[0];
    expect(nine.rank).toBe("9");

    const r = applyAction(drawn.state, {
      type: "playMelds",
      melds: [{ rank: "9", cardIds: [nine.id] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].foot).toHaveLength(0);
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.wentOutSeat).toBeUndefined();
    expect(r.state.currentSeat).toBe(1);
    expect(r.state.phase).toBe("draw");
  });
});
