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
import { scoreRound } from "./scoreRound";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `sa${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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
/** A fresh set of the books EAST_COAST requires to go out (1 clean, 2 dirty). */
function books(): Meld[] {
  return [cleanBook("K"), dirtyBook("Q"), dirtyBook("J")];
}
function player(over: Partial<PlayerState>): PlayerState {
  return { hand: [], foot: [], melds: [], isDown: true, inFoot: true, footPending: false, ...over };
}
function tableOf(players: PlayerState[], over: Partial<GameState> = {}): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "play",
    stock: cards("9", 10),
    discard: [card("8")],
    ...over,
  };
}

/** In the foot and down, but one clean book short of the two dirty books needed. */
function shortOfGoingOut(foot: Card[], melds: Meld[] = [cleanBook("K")]): GameState {
  const p: PlayerState = {
    hand: [],
    foot,
    melds,
    isDown: true,
    inFoot: true,
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
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p, q],
    currentSeat: 0,
    phase: "play",
    stock: cards("9", 10),
    discard: [card("8")],
  };
}

describe("shedding every card without the books to go out", () => {
  it("allows the last foot card to be discarded, ending the turn without ending the round", () => {
    const five = card("5");
    const s = shortOfGoingOut([five]);
    const r = applyAction(s, { type: "discard", cardId: five.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.wentOutSeat).toBeUndefined();
    expect(r.state.players[0].foot).toHaveLength(0);
    expect(r.state.currentSeat).toBe(1);
    expect(r.state.phase).toBe("draw");
    expect(r.state.discard.at(-1)?.id).toBe(five.id);
  });

  it("ends the turn without a discard when melding empties the foot", () => {
    const fours = cards("4", 3);
    const s = shortOfGoingOut([...fours]);
    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "4", cardIds: fours.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0].foot).toHaveLength(0);
    expect(r.state.roundEnded ?? false).toBe(false);
    expect(r.state.wentOutSeat).toBeUndefined();
    expect(r.state.finalLapRemaining).toBeUndefined();
    expect(r.state.currentSeat).toBe(1);
    expect(r.state.phase).toBe("draw");
    // The turn genuinely moved on: the next seat can act.
    expect(applyAction(r.state, { type: "draw" }).ok).toBe(true);
  });

  // The regression: melding down to a single card used to leave the player with no
  // legal action at all, because the only remaining move was a discard that was
  // rejected for lack of the go-out books.
  it("never deadlocks a turn after melding down to one card", () => {
    const fours = cards("4", 3);
    const five = card("5");
    const s = shortOfGoingOut([...fours, five]);
    const melded = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "4", cardIds: fours.map((c) => c.id) }],
    });
    expect(melded.ok).toBe(true);
    if (!melded.ok) return;
    expect(melded.state.players[0].foot).toHaveLength(1);

    const discarded = applyAction(melded.state, { type: "discard", cardId: five.id });
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.state.currentSeat).toBe(1);
    expect(discarded.state.roundEnded ?? false).toBe(false);
  });

  it("keeps a cardless player in the round, drawing into the foot on their next turn", () => {
    const five = card("5");
    const shed = applyAction(shortOfGoingOut([five]), { type: "discard", cardId: five.id });
    expect(shed.ok).toBe(true);
    if (!shed.ok) return;

    // Pass seat 1 back to the cardless player.
    const back: GameState = { ...shed.state, currentSeat: 0, phase: "draw" };
    const drawn = applyAction(back, { type: "draw" });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.state.players[0].inFoot).toBe(true);
    expect(drawn.state.players[0].foot).toHaveLength(1);
    expect(drawn.state.phase).toBe("play");
  });

  it("still goes out, with the bonus, once the books are complete", () => {
    const five = card("5");
    const r = applyAction(shortOfGoingOut([five], books()), {
      type: "discard",
      cardId: five.id,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.roundEnded).toBe(true);
    expect(r.state.wentOutSeat).toBe(0);
    expect(scoreRound(r.state)[0].score).toBeGreaterThan(
      scoreRound({ ...r.state, wentOutSeat: 1 })[0].score,
    );
  });

  it("gives no go-out bonus to a cardless player who did not go out", () => {
    const five = card("5");
    const shed = applyAction(shortOfGoingOut([five]), { type: "discard", cardId: five.id });
    expect(shed.ok).toBe(true);
    if (!shed.ok) return;

    // Seat 0 holds nothing, but seat 1 ended the round.
    const ended: GameState = { ...shed.state, roundEnded: true, wentOutSeat: 1 };
    const withBonus = scoreRound({ ...ended, wentOutSeat: 0 })[0].score;
    expect(scoreRound(ended)[0].score).toBe(withBonus - EAST_COAST.scoring.goOutBonus);
  });
});

describe("exactly one player goes out per round", () => {
  // Seat 0 goes out without a discard; seat 1, who also holds the books, sheds every
  // card during the final lap. Both end the round with no cards and complete books,
  // so they are indistinguishable except for who actually went out.
  it("awards the bonus only to the player who went out, played through end to end", () => {
    // Both shed an identical three-of-a-kind, so their melded totals match and the
    // only possible difference in their scores is the go-out bonus.
    const tens0 = cards("10", 3);
    const tens1 = cards("10", 3);
    const p0 = player({ foot: [...tens0], melds: books() });
    const p1 = player({ foot: [...tens1], melds: books() });
    const p2 = player({ inFoot: false, isDown: false, hand: [card("6"), card("7")] });

    // Seat 0 melds its last three cards: going out without a discard.
    const out = applyAction(tableOf([p0, p1, p2]), {
      type: "playMelds",
      melds: [{ rank: "10", cardIds: tens0.map((c) => c.id) }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.wentOutSeat).toBe(0);
    expect(out.state.finalLapRemaining).toBe(2);
    expect(out.state.currentSeat).toBe(1);

    // Seat 1 takes its final-lap turn: draw, meld the 10s, discard the drawn card,
    // which empties its foot too.
    const drew = applyAction(out.state, { type: "draw" });
    expect(drew.ok).toBe(true);
    if (!drew.ok) return;
    const drawn = drew.state.players[1].foot.at(-1);
    const melded = applyAction(drew.state, {
      type: "playMelds",
      melds: [{ rank: "10", cardIds: tens1.map((c) => c.id) }],
    });
    expect(melded.ok).toBe(true);
    if (!melded.ok) return;
    const shed = applyAction(melded.state, { type: "discard", cardId: drawn!.id });
    expect(shed.ok).toBe(true);
    if (!shed.ok) return;

    // Seat 1 now looks exactly like a go-out: no cards, and the books to go out.
    expect(shed.state.players[1].hand).toHaveLength(0);
    expect(shed.state.players[1].foot).toHaveLength(0);
    // But the round still belongs to seat 0, and the final lap kept counting down.
    expect(shed.state.wentOutSeat).toBe(0);
    expect(shed.state.finalLapRemaining).toBe(1);
    expect(shed.state.currentSeat).toBe(2);
    expect(shed.state.roundEnded ?? false).toBe(false);

    // Seat 2 takes the last turn of the lap and the round ends.
    const d2 = applyAction(shed.state, { type: "draw" });
    expect(d2.ok).toBe(true);
    if (!d2.ok) return;
    const end = applyAction(d2.state, { type: "discard", cardId: d2.state.players[2].hand[0].id });
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    expect(end.state.roundEnded).toBe(true);
    expect(end.state.wentOutSeat).toBe(0);

    // Seats 0 and 1 melded identical books and both hold nothing, so the whole
    // difference between their scores is the go-out bonus.
    const scores = scoreRound(end.state);
    expect(scores[0].score - scores[1].score).toBe(EAST_COAST.scoring.goOutBonus);
  });

  it("does not transfer the go-out when a later player's discard empties their foot", () => {
    const five = card("5");
    const p0 = player({ melds: books() });
    const p1 = player({ foot: [five], melds: books() });
    const s = tableOf([p0, p1], { currentSeat: 1, wentOutSeat: 0, finalLapRemaining: 2 });

    const r = applyAction(s, { type: "discard", cardId: five.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[1].foot).toHaveLength(0);
    expect(r.state.wentOutSeat).toBe(0);
    // Treated as an ordinary turn ending, so the final lap counts down.
    expect(r.state.finalLapRemaining).toBe(1);
    expect(r.state.roundEnded ?? false).toBe(false);
  });

  it("does not restart the final lap when a later player melds their foot empty", () => {
    const fours = cards("4", 3);
    const p0 = player({ melds: books() });
    const p1 = player({ foot: [...fours], melds: books() });
    const s = tableOf([p0, p1], { currentSeat: 1, wentOutSeat: 0, finalLapRemaining: 2 });

    const r = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "4", cardIds: fours.map((c) => c.id) }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[1].foot).toHaveLength(0);
    expect(r.state.wentOutSeat).toBe(0);
    expect(r.state.finalLapRemaining).toBe(1);
  });

  it("scores at most one go-out bonus across the table", () => {
    const p0 = player({ melds: books() });
    const p1 = player({ melds: books() });
    const p2 = player({ melds: books() });
    const s = tableOf([p0, p1, p2], { roundEnded: true, wentOutSeat: 1 });
    const scores = scoreRound(s);
    const bonuses = scores.filter((r) => r.score === Math.max(...scores.map((x) => x.score)));
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0].seat).toBe(1);
    expect(scores[0].score).toBe(scores[2].score);
    expect(scores[1].score - scores[0].score).toBe(EAST_COAST.scoring.goOutBonus);
  });
});
