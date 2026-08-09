import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { chooseDiscard, defaultAction } from "./policy";
import { applyAction } from "./reducer";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `pol${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
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
function table(p0: PlayerState, over: Partial<GameState> = {}): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, player({ isDown: false })],
    currentSeat: 0,
    phase: "play",
    stock: [card("7")],
    discard: [],
    ...over,
  };
}

describe("chooseDiscard", () => {
  it("throws a red three before anything else, since holding one costs 500", () => {
    const three = card("3", "hearts");
    const s = table(player({ hand: [card("K"), three, card("4")] }));
    expect(chooseDiscard(s, 0)?.id).toBe(three.id);
  });

  it("never throws a wild while any other card is available", () => {
    const s = table(player({ hand: [card("2"), card("JOKER"), card("4")] }));
    const picked = chooseDiscard(s, 0);
    expect(picked?.rank).toBe("4");
  });

  it("throws a wild only when it is the last card left", () => {
    const s = table(player({ hand: [card("JOKER")] }));
    expect(chooseDiscard(s, 0)?.rank).toBe("JOKER");
  });

  it("keeps cards that have partners and throws the loner", () => {
    const loner = card("9");
    const s = table(player({ hand: [...cards("K", 3), loner] }));
    expect(chooseDiscard(s, 0)?.id).toBe(loner.id);
  });

  it("keeps a lone card that has a meld to join over a pair with none", () => {
    // One card completes an existing meld, which beats holding two of a rank
    // nobody is collecting.
    const joiner = card("K");
    const s = table(
      player({ hand: [joiner, ...cards("9", 2)], melds: [{ rank: "K", cards: cards("K", 3) }] }),
    );
    const picked = chooseDiscard(s, 0);
    expect(picked?.rank).toBe("9");
  });

  it("sheds the most points when two cards are equally useless", () => {
    // Both are loners; the ace costs 15 against you and the four only 5.
    const ace = card("A");
    const s = table(player({ hand: [ace, card("4")] }));
    expect(chooseDiscard(s, 0)?.id).toBe(ace.id);
  });

  it("picks the same card every time, so a replayed log lands in the same place", () => {
    const hand = [card("5"), card("6"), card("7")];
    const s = table(player({ hand }));
    const first = chooseDiscard(s, 0);
    // Same cards, different order: the tie-break must not depend on position.
    const shuffled = table(player({ hand: [hand[2], hand[0], hand[1]] }));
    expect(chooseDiscard(shuffled, 0)?.id).toBe(first?.id);
  });

  it("breaks a dead-even tie toward the lower card id", () => {
    // Two cards of one rank are each other's companion and score the same, so
    // only the id separates them. Which one wins is arbitrary, but it is part of
    // the replay contract: a log replayed by a later build has to land on the
    // same card, so the direction is pinned rather than left to chance.
    const lower: Card = { id: "aaa", rank: "4", suit: "clubs" };
    const higher: Card = { id: "bbb", rank: "4", suit: "spades" };
    expect(chooseDiscard(table(player({ hand: [lower, higher] })), 0)?.id).toBe("aaa");
    expect(chooseDiscard(table(player({ hand: [higher, lower] })), 0)?.id).toBe("aaa");
  });

  it("discards from the foot once the player is in it", () => {
    // The hand is empty by then, so reading the wrong zone returns null rather
    // than a card: this pins that the foot is what gets played from.
    const loner = card("9");
    const s = table(player({ inFoot: true, hand: [], foot: [...cards("K", 3), loner] }));
    expect(chooseDiscard(s, 0)?.id).toBe(loner.id);
  });

  it("returns null on an empty zone", () => {
    expect(chooseDiscard(table(player({ hand: [] })), 0)).toBeNull();
  });
});

describe("defaultAction", () => {
  it("draws in the draw phase", () => {
    const s = table(player({ hand: [card("K")] }), { phase: "draw" });
    expect(defaultAction(s)).toEqual({ type: "draw" });
  });

  it("never takes the pile, even when taking it is legal", () => {
    // An absent player must not be handed a take-pile obligation to settle.
    const s = table(player({ isDown: true, hand: cards("K", 2), melds: [] }), {
      phase: "draw",
      discard: [card("K"), card("K"), card("K")],
    });
    expect(defaultAction(s)).toEqual({ type: "draw" });
  });

  it("discards in the play phase", () => {
    const loner = card("9");
    const s = table(player({ hand: [...cards("K", 3), loner] }));
    expect(defaultAction(s)).toEqual({ type: "discard", cardId: loner.id });
  });

  it("returns null once the round has ended", () => {
    const s = table(player({ hand: [card("K")] }), { roundEnded: true });
    expect(defaultAction(s)).toBeNull();
  });

  it("settles a take-pile obligation instead of attempting a refused discard", () => {
    // A discard is rejected while a picked-up card still owes a play, so the
    // naive "just discard something" default would loop forever here.
    const pile = cards("5", 2);
    const s = table(
      player({
        isDown: true,
        hand: [card("5"), ...pile, card("K")],
        pickedUp: pile.map((c) => c.id),
      }),
    );
    const action = defaultAction(s);
    expect(action?.type).toBe("playMelds");

    const r = applyAction(s, action!);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The obligation is discharged, so the turn can now actually end.
      expect(r.state.players[0].pickedUp).toEqual([]);
      const next = defaultAction(r.state);
      expect(next?.type).toBe("discard");
      expect(applyAction(r.state, next!).ok).toBe(true);
    }
  });

  it("settles an obligation by extending an existing meld with the single pile card", () => {
    const pileCard = card("K");
    const s = table(
      player({
        isDown: true,
        hand: [pileCard],
        melds: [{ rank: "K", cards: cards("K", 3) }],
        pickedUp: [pileCard.id],
      }),
    );
    expect(defaultAction(s)).toEqual({
      type: "playMelds",
      melds: [{ rank: "K", cardIds: [pileCard.id] }],
    });
  });

  it("still settles the obligation after a lay-down that deliberately skipped it", () => {
    // The sharp case, and the reason the seat can never be stranded: a player
    // takes the pile, then plays a meld that touches no pile card, leaving the
    // obligation open. Whatever naturals that play consumed belonged to a rank it
    // just melded, so the pile card can always extend something afterwards.
    const pileFive = card("5");
    const handNine = card("9");
    const s = table(
      player({
        isDown: true,
        hand: [...cards("5", 2), pileFive, handNine],
        melds: [{ rank: "9", cards: cards("9", 3) }],
        pickedUp: [pileFive.id],
      }),
    );

    // A real, accepted play that ignores the pile card entirely.
    const skipped = applyAction(s, {
      type: "playMelds",
      melds: [{ rank: "9", cardIds: [handNine.id] }],
    });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.state.players[0].pickedUp).toEqual([pileFive.id]);

    // A discard is still refused, so the default has to find the way out.
    expect(applyAction(skipped.state, { type: "discard", cardId: pileFive.id }).ok).toBe(false);

    const action = defaultAction(skipped.state);
    expect(action?.type).toBe("playMelds");
    const r = applyAction(skipped.state, action!);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.players[0].pickedUp).toEqual([]);
  });

  it("produces an action the reducer accepts for a player owing a pile card in the foot", () => {
    const pileCard = card("Q");
    const s = table(
      player({
        isDown: true,
        inFoot: true,
        hand: [],
        foot: [pileCard, ...cards("Q", 2), card("4")],
        pickedUp: [pileCard.id],
      }),
    );
    const action = defaultAction(s);
    expect(action?.type).toBe("playMelds");
    expect(applyAction(s, action!).ok).toBe(true);
  });
});
