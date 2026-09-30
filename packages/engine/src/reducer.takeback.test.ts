import { describe, it, expect } from "vitest";
import {
  EAST_COAST,
  type Card,
  type GameState,
  type MeldPlay,
  type PlayerState,
  type Rank,
  type Suit,
} from "@hf/shared";
import { applyAction } from "./reducer";
import { project } from "./view";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `t${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number): Card[] {
  return Array.from({ length: n }, () => card(rank));
}
function player(over: Partial<PlayerState>): PlayerState {
  return {
    hand: [],
    foot: cards("4", 3),
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
    ...over,
  };
}
function stateWith(p0: PlayerState, phase: "draw" | "play" = "play"): GameState {
  return {
    config: EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p0, player({ hand: cards("6", 5) })],
    currentSeat: 0,
    phase,
    stock: cards("9", 10),
    discard: [card("8")],
  };
}
function play(state: GameState, melds: MeldPlay[]): GameState {
  const r = applyAction(state, { type: "playMelds", melds });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
function ids(cs: readonly Card[]): string[] {
  return cs.map((c) => c.id);
}

describe("taking back this turn's plays", () => {
  it("puts every card back and the melds as they were, the go-down included", () => {
    const kings = cards("K", 3);
    const queens = cards("Q", 3);
    const spare = card("5");
    const before = stateWith(player({ hand: [...kings, ...queens, spare] }));
    const played = play(before, [
      { rank: "K", cardIds: ids(kings) },
      { rank: "Q", cardIds: ids(queens) },
    ]);
    expect(played.players[0].isDown).toBe(true);

    const r = applyAction(played, { type: "takeBack" });
    expect(r.ok).toBe(true);
    // Exactly the turn as it was before the first play: nothing kept, nothing lost.
    expect(r.ok && r.state).toEqual(before);
  });

  it("undoes several plays in one go, back to before the first", () => {
    const kings = cards("K", 4);
    const queens = cards("Q", 3);
    const down: PlayerState = player({
      // A spare, so the plays do not empty the hand into the foot.
      hand: [kings[3]!, ...queens, card("5")],
      melds: [{ rank: "K", cards: kings.slice(0, 3) }],
      isDown: true,
    });
    const before = stateWith(down);
    const once = play(before, [{ rank: "K", cardIds: [kings[3]!.id] }]);
    const twice = play(once, [{ rank: "Q", cardIds: ids(queens) }]);
    const r = applyAction(twice, { type: "takeBack" });
    expect(r.ok && r.state).toEqual(before);
    // The melds that were down before the turn stay down.
    expect(r.ok && r.state.players[0].melds).toEqual([{ rank: "K", cards: kings.slice(0, 3) }]);
  });

  it("lets a wild be moved to another meld by taking back and playing again", () => {
    const kings = cards("K", 2);
    const queens = cards("Q", 2);
    const wild = card("2");
    const down = player({
      hand: [...kings, ...queens, wild, card("5")],
      melds: [{ rank: "A", cards: cards("A", 3) }],
      isDown: true,
    });
    const onKings = play(stateWith(down), [{ rank: "K", cardIds: [...ids(kings), wild.id] }]);
    const back = applyAction(onKings, { type: "takeBack" });
    if (!back.ok) throw new Error(back.error);
    const onQueens = play(back.state, [{ rank: "Q", cardIds: [...ids(queens), wild.id] }]);
    expect(onQueens.players[0].melds.map((m) => m.rank)).toEqual(["A", "Q"]);
  });

  it("owes the pile its play again when the play that settled it is taken back", () => {
    const pile = card("K");
    const kings = cards("K", 2);
    const before = stateWith(
      player({
        hand: [pile, ...kings, card("5")],
        melds: [{ rank: "A", cards: cards("A", 3) }],
        isDown: true,
        pickedUp: [pile.id],
      }),
    );
    const settled = play(before, [{ rank: "K", cardIds: [pile.id, ...ids(kings)] }]);
    expect(settled.players[0].pickedUp).toEqual([]);
    const r = applyAction(settled, { type: "takeBack" });
    expect(r.ok && r.state.players[0].pickedUp).toEqual([pile.id]);
    // So the discard is refused again until the pile card is played.
    const discard = applyAction(r.ok ? r.state : settled, {
      type: "discard",
      cardId: before.players[0].hand[3]!.id,
    });
    expect(discard).toEqual({
      ok: false,
      error: "you must play at least one card taken from the pile before discarding",
    });
  });

  it("is refused with nothing played this turn, before drawing, and once the turn is over", () => {
    const hand = [...cards("K", 3), card("5"), card("7")];
    expect(applyAction(stateWith(player({ hand })), { type: "takeBack" })).toEqual({
      ok: false,
      error: "nothing has been played this turn to take back",
    });
    expect(applyAction(stateWith(player({ hand }), "draw"), { type: "takeBack" })).toEqual({
      ok: false,
      error: "there is nothing to take back before drawing",
    });
    // Played, then discarded: the turn has ended and its plays are final. The next
    // seat has nothing of its own to take back.
    const played = play(stateWith(player({ hand, isDown: true })), [
      { rank: "K", cardIds: ids(hand.slice(0, 3)) },
    ]);
    const discarded = applyAction(played, { type: "discard", cardId: hand[3]!.id });
    if (!discarded.ok) throw new Error(discarded.error);
    expect(discarded.state.turnBase).toBeUndefined();
    const next = applyAction(discarded.state, { type: "draw" });
    if (!next.ok) throw new Error(next.error);
    expect(applyAction(next.state, { type: "takeBack" }).ok).toBe(false);
  });

  it("makes plays final once they empty the hand into the foot, which the player has now seen", () => {
    const kings = cards("K", 3);
    const foot = [...cards("Q", 3), card("7")];
    const into = play(stateWith(player({ hand: kings, foot, isDown: true })), [
      { rank: "K", cardIds: ids(kings) },
    ]);
    expect(into.players[0].inFoot).toBe(true);
    expect(applyAction(into, { type: "takeBack" }).ok).toBe(false);
    // Plays from the foot after that can be taken back, to where the foot began.
    const fromFoot = play(into, [{ rank: "Q", cardIds: ids(foot.slice(0, 3)) }]);
    const r = applyAction(fromFoot, { type: "takeBack" });
    expect(r.ok && r.state).toEqual(into);
  });

  it("keeps no base once a play ends the turn by shedding the last foot card", () => {
    const kings = cards("K", 3);
    const out = play(stateWith(player({ hand: [], foot: kings, inFoot: true, isDown: true })), [
      { rank: "K", cardIds: ids(kings) },
    ]);
    expect(out.currentSeat).toBe(1);
    expect(out.turnBase).toBeUndefined();
  });

  it("clears the base when a play goes out, starting the final lap", () => {
    const clean = { rank: "A" as Rank, cards: cards("A", 7) };
    const dirty1 = { rank: "J" as Rank, cards: [...cards("J", 6), card("2")] };
    const dirty2 = { rank: "10" as Rank, cards: [...cards("10", 6), card("2")] };
    const kings = cards("K", 3);
    const out = play(
      stateWith(
        player({
          hand: [],
          foot: kings,
          inFoot: true,
          isDown: true,
          melds: [clean, dirty1, dirty2],
        }),
      ),
      [{ rank: "K", cardIds: ids(kings) }],
    );
    expect(out.wentOutSeat).toBe(0);
    expect(out.turnBase).toBeUndefined();
  });
});

describe("going out with a discard after playing this turn", () => {
  it("leaves nothing to take back in the finished round", () => {
    const clean = { rank: "A" as Rank, cards: cards("A", 7) };
    const dirty1 = { rank: "J" as Rank, cards: [...cards("J", 6), card("2")] };
    const dirty2 = { rank: "10" as Rank, cards: [...cards("10", 6), card("2")] };
    const kings = cards("K", 3);
    const last = card("5");
    const played = play(
      stateWith(
        player({
          hand: [],
          foot: [...kings, last],
          inFoot: true,
          isDown: true,
          melds: [clean, dirty1, dirty2],
        }),
      ),
      [{ rank: "K", cardIds: ids(kings) }],
    );
    const out = applyAction(played, { type: "discard", cardId: last.id });
    if (!out.ok) throw new Error(out.error);
    expect(out.state.roundEnded).toBe(true);
    expect(out.state.turnBase).toBeUndefined();
    expect(project(out.state, 0).playedThisTurn).toEqual([]);
  });
});

describe("what the view says can be taken back", () => {
  it("lists this turn's played cards to their player, on their turn only", () => {
    const kings = cards("K", 3);
    const extra = card("A");
    const down = player({
      hand: [...kings, extra, card("5")],
      melds: [{ rank: "A", cards: cards("A", 3) }],
      isDown: true,
    });
    const played = play(stateWith(down), [
      { rank: "K", cardIds: ids(kings) },
      { rank: "A", cardIds: [extra.id] },
    ]);
    expect([...project(played, 0).playedThisTurn].sort()).toEqual([...ids(kings), extra.id].sort());
    // Before anything is played, there is nothing.
    expect(project(stateWith(down), 0).playedThisTurn).toEqual([]);
  });
});
