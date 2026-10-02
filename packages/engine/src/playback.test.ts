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
import { activeCards } from "./core";
import { CHECKPOINT_EVERY, TimelineError, buildTimeline, type GameLog } from "./playback";
import { deal } from "./deal";
import { defaultAction } from "./policy";
import { applyAction } from "./reducer";
import { replay } from "./replay";
import { recordRich } from "./testing/golden";

let idc = 0;
function card(rank: Rank, suit: Suit = "clubs"): Card {
  return { id: `pb${idc++}`, rank, suit: rank === "JOKER" ? null : suit };
}
function cards(rank: Rank, n: number, suit: Suit = "clubs"): Card[] {
  return Array.from({ length: n }, () => card(rank, suit));
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
function table(players: PlayerState[], over: Partial<GameState> = {}): GameState {
  return {
    config: EAST_COAST,
    seed: 7,
    roundNumber: 1,
    players,
    currentSeat: 0,
    phase: "draw",
    stock: cards("6", 30, "hearts"),
    discard: [card("8", "spades")],
    ...over,
  };
}
const meld = (rank: Rank, cs: Card[]): Meld => ({ rank, cards: cs });

/**
 * Play a list of intentions against a position, resolving each to a concrete
 * action from the state at that point — "discard a 9" rather than a card id.
 */
type Intent =
  | Action
  | { readonly type: "discardRank"; readonly rank: Rank }
  | { readonly type: "meldPicked"; readonly rank: Rank };
function play(start: GameState, intents: readonly Intent[]): Action[] {
  let state = start;
  const out: Action[] = [];
  for (const intent of intents) {
    const zone = activeCards(state.players[state.currentSeat]!);
    let action: Action;
    if (intent.type === "discardRank") {
      action = { type: "discard", cardId: zone.find((c) => c.rank === intent.rank)!.id };
    } else if (intent.type === "meldPicked") {
      const owed = new Set(state.players[state.currentSeat]!.pickedUp);
      const c = zone.find((x) => owed.has(x.id) && x.rank === intent.rank)!;
      action = { type: "playMelds", melds: [{ rank: intent.rank, cardIds: [c.id] }] };
    } else {
      action = intent;
    }
    const r = applyAction(state, action);
    if (!r.ok) throw new Error(`fixture action refused: ${r.error}`);
    state = r.state;
    out.push(action);
  }
  return out;
}

describe("a timeline over a golden game", () => {
  const { actions, finalState } = recordRich(36, 4, 150);
  const log: GameLog = {
    config: EAST_COAST,
    setup: { seed: 36, playerCount: 4 },
    actions,
    names: ["Ana", "Ben"],
  };

  it("gives the same state at every step as replaying that many actions, in any order", () => {
    const timeline = buildTimeline(log);
    expect(timeline.length).toBe(actions.length);
    expect(timeline.length).toBeGreaterThan(CHECKPOINT_EVERY * 2);
    expect(timeline.playerCount).toBe(4);
    expect(timeline.stateAt(timeline.length)).toEqual(finalState);
    // Backward, forward, and jumping about: checkpoints and the cache must agree.
    const order = [
      ...Array.from({ length: actions.length + 1 }, (_, k) => actions.length - k),
      0,
      1,
      2,
      CHECKPOINT_EVERY + 3,
      5,
      CHECKPOINT_EVERY * 2,
      CHECKPOINT_EVERY * 2 + 1,
      CHECKPOINT_EVERY - 1,
    ];
    for (const step of order) {
      expect(timeline.stateAt(step)).toEqual(replay(36, 4, EAST_COAST, actions.slice(0, step)));
    }
  });

  it("records each action with the seat it was applied to and the move it made", () => {
    const timeline = buildTimeline(log);
    for (let step = 1; step <= timeline.length; step++) {
      const entry = timeline.entry(step);
      expect(entry.action).toBe(actions[step - 1]);
      expect(entry.seat).toBe(timeline.stateAt(step - 1).currentSeat);
      expect(entry.move?.seq).toBe(step);
      expect(entry.move?.seat).toBe(entry.seat);
    }
  });

  it("marks every pile pickup, and every player getting down, where it happens", () => {
    const timeline = buildTimeline(log);
    const taken = timeline.moments.filter((m) => m.kind === "pileTaken").map((m) => m.step);
    const takeSteps = actions.flatMap((a, i) => (a.type === "takePile" ? [i + 1] : []));
    expect(taken).toEqual(takeSteps);
    expect(taken.length).toBeGreaterThan(0);
    const first = timeline.moments.find((m) => m.kind === "pileTaken")!;
    expect(first.label).toMatch(/took the pile \(\d+\)$/);
    for (const m of timeline.moments.filter((x) => x.kind === "gotDown")) {
      expect(timeline.stateAt(m.step - 1).players[m.seat!]!.isDown).toBe(false);
      expect(timeline.stateAt(m.step).players[m.seat!]!.isDown).toBe(true);
    }
    expect(timeline.moments.some((m) => m.kind === "gotDown")).toBe(true);
  });

  it("splits the game into turns that follow one another and cover it", () => {
    const timeline = buildTimeline(log);
    expect(timeline.turns[0]!.start).toBe(0);
    timeline.turns.forEach((turn, i) => {
      expect(turn.end).toBeGreaterThan(turn.start);
      expect(timeline.stateAt(turn.start).currentSeat).toBe(turn.seat);
      if (i > 0) expect(turn.start).toBe(timeline.turns[i - 1]!.end);
      for (let s = turn.start + 1; s <= turn.end; s++)
        expect(timeline.entry(s).seat).toBe(turn.seat);
    });
    expect(timeline.turns.at(-1)!.end).toBe(timeline.length);
    // Unfinished: one round, open at the end.
    expect(timeline.rounds).toEqual([{ number: 1, start: 0, end: timeline.length }]);
  });

  it("names players from the log, and anyone it does not name by seat", () => {
    const timeline = buildTimeline(log);
    expect(timeline.nameOf(0)).toBe("Ana");
    expect(timeline.nameOf(3)).toBe("Seat 3");
  });
});

describe("a deal that did not start at seat 0", () => {
  it("starts at the seat its setup names, and at seat 0 when it names none", () => {
    const from = (firstSeat?: number) =>
      buildTimeline({
        config: EAST_COAST,
        setup: { seed: 8, playerCount: 3, firstSeat },
        actions: [],
      });
    expect(from(2).stateAt(0).currentSeat).toBe(2);
    expect(from(undefined).stateAt(0).currentSeat).toBe(0);
  });
});

describe("moments found in any game", () => {
  it("marks a foot picked up by melding the hand away, mid-turn", () => {
    const kings = cards("K", 3);
    const last = card("K", "hearts");
    const start = table(
      [player({ isDown: true, melds: [meld("K", kings)], hand: [last] }), player({})],
      {
        phase: "play",
      },
    );
    const timeline = buildTimeline({
      config: EAST_COAST,
      setup: { state: start },
      actions: [{ type: "playMelds", melds: [{ rank: "K", cardIds: [last.id] }] }],
    });
    expect(timeline.moments).toEqual([
      {
        id: "footPickedUp-1-0",
        kind: "footPickedUp",
        label: "Seat 0 picked up the foot",
        step: 1,
        seat: 0,
      },
    ]);
  });

  it("marks a pending foot where the turn comes back round and picks it up", () => {
    const start = table(
      [
        player({ isDown: true, melds: [meld("K", cards("K", 3))], hand: [card("9")] }),
        player({ hand: [card("5")] }),
      ],
      { phase: "play" },
    );
    const actions = play(start, [
      { type: "discardRank", rank: "9" },
      { type: "draw" },
      { type: "discardRank", rank: "6" },
    ]);
    const timeline = buildTimeline({ config: EAST_COAST, setup: { state: start }, actions });
    const pickup = timeline.moments.find((m) => m.kind === "footPickedUp")!;
    // Picked up as the turn reaches them, which is the discard that ended the other turn.
    expect(pickup).toMatchObject({ step: 3, seat: 0 });
    expect(timeline.turns.map((t) => [t.seat, t.start, t.end])).toEqual([
      [0, 0, 1],
      [1, 1, 3],
    ]);
  });

  /** In the foot with the go-out books — one clean, two dirty — and one card left. */
  function readyToGoOut(roundNumber: number, rules: RulesConfig): GameState {
    const out = player({
      isDown: true,
      inFoot: true,
      hand: [],
      foot: [card("5")],
      melds: [
        meld("K", cards("K", 7)),
        meld("Q", [...cards("Q", 6), card("2")]),
        meld("J", [...cards("J", 6), card("JOKER")]),
      ],
    });
    return table([out, player({ hand: [card("7")] })], {
      phase: "play",
      roundNumber,
      config: rules,
    });
  }

  it("marks going out, the round ending, and dealing the next round", () => {
    const rules = { ...EAST_COAST, rounds: 2 };
    const start = readyToGoOut(1, rules);
    const actions = [
      ...play(start, [{ type: "discardRank", rank: "5" }]),
      { type: "nextRound" } as const,
    ];
    const timeline = buildTimeline({
      config: rules,
      setup: { state: start },
      actions,
      names: ["Ana"],
    });
    expect(timeline.moments.map((m) => [m.kind, m.step, m.label])).toEqual([
      ["wentOut", 1, "Ana went out"],
      ["roundEnded", 1, "Round 1 ended"],
    ]);
    expect(timeline.rounds).toEqual([
      { number: 1, start: 0, end: 1 },
      { number: 2, start: 2, end: 2 },
    ]);
    // Dealing is not a move, and is no one's turn.
    expect(timeline.entry(2).move).toBeNull();
    expect(timeline.turns).toEqual([{ round: 1, seat: 0, start: 0, end: 1 }]);
    expect(timeline.stateAt(2).roundNumber).toBe(2);
  });

  it("marks a player leaving between rounds, as nobody's turn", () => {
    const rules: RulesConfig = { ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" };
    const actions: Action[] = [];
    let state = deal(3, rules, 5);
    while (!state.roundEnded) {
      const action = defaultAction(state)!;
      actions.push(action);
      const r = applyAction(state, action);
      if (!r.ok) throw new Error(r.error);
      state = r.state;
    }
    const ended = actions.length;
    actions.push({ type: "removePlayer", seat: 1 }, { type: "nextRound" });
    const timeline = buildTimeline({
      config: rules,
      setup: { seed: 5, playerCount: 3 },
      actions,
      names: ["Ana", "Bo", "Cy"],
    });
    expect(
      timeline.moments.filter((m) => m.step > ended - 1).map((m) => [m.kind, m.step, m.label]),
    ).toEqual([
      ["roundEnded", ended, "Round 1 ended"],
      ["playerLeft", ended + 1, "Bo left the game"],
    ]);
    expect(timeline.moments.at(-1)!.seat).toBe(1);
    expect(timeline.entry(ended + 1).move).toBeNull();
    expect(timeline.turns.at(-1)!.end).toBe(ended);
    expect(timeline.rounds.map((r) => [r.number, r.start, r.end])).toEqual([
      [1, 0, ended],
      [2, ended + 2, ended + 2],
    ]);
    expect(timeline.stateAt(ended + 2).departed).toEqual([{ seat: 1, afterRound: 1 }]);
  });

  it("marks going out once, at the meld that does it, and the final lap as turns", () => {
    // Out without a discard: melding the last card starts a lap for everyone else.
    const start = readyToGoOut(1, EAST_COAST);
    const out = start.players[0]!;
    const fives = player({
      ...out,
      foot: [card("5")],
      melds: [...out.melds, meld("5", cards("5", 3))],
    });
    const lapStart = { ...start, players: [fives, start.players[1]!] };
    const actions = play(lapStart, [
      { type: "playMelds", melds: [{ rank: "5", cardIds: [fives.foot[0]!.id] }] },
      { type: "draw" },
      { type: "discardRank", rank: "7" },
    ]);
    const timeline = buildTimeline({
      config: EAST_COAST,
      setup: { state: lapStart },
      actions,
      moments: [{ id: "out", label: "Out", step: 1 }],
    });
    // The named moment leads the ones found at the same step.
    expect(timeline.moments.map((m) => [m.kind, m.step])).toEqual([
      ["named", 1],
      ["wentOut", 1],
      ["roundEnded", 3],
    ]);
    expect(timeline.turns.map((t) => [t.seat, t.start, t.end])).toEqual([
      [0, 0, 1],
      [1, 1, 3],
    ]);
  });

  it("marks the end of the match after the last round", () => {
    const rules = { ...EAST_COAST, rounds: 2 };
    const start = readyToGoOut(2, rules);
    const timeline = buildTimeline({
      config: rules,
      setup: { state: start },
      actions: play(start, [{ type: "discardRank", rank: "5" }]),
    });
    expect(timeline.moments.map((m) => m.kind)).toEqual(["wentOut", "roundEnded", "matchOver"]);
  });

  it("starts from a round already over, as a position built to deal the next one", () => {
    const start = table([player({}), player({})], { roundEnded: true });
    const timeline = buildTimeline({
      config: EAST_COAST,
      setup: { state: start },
      actions: [{ type: "nextRound" }, { type: "draw" }],
    });
    expect(timeline.rounds).toEqual([
      { number: 1, start: 0, end: 0 },
      { number: 2, start: 1, end: 2 },
    ]);
    // Round 2's first turn is the next seat's, from the deal.
    expect(timeline.turns).toEqual([{ round: 2, seat: 1, start: 1, end: 2 }]);
    expect(timeline.moments).toEqual([]);
  });

  it("plays a hand-built position under the log's rules, not the ones it was built with", () => {
    const start = readyToGoOut(2, EAST_COAST);
    const rules = { ...EAST_COAST, rounds: 2 };
    const timeline = buildTimeline({
      config: rules,
      setup: { state: start },
      actions: play(start, [{ type: "discardRank", rank: "5" }]),
    });
    expect(timeline.stateAt(0).config).toBe(rules);
    // Under the preset's four rounds this would not have been the last.
    expect(timeline.moments.some((m) => m.kind === "matchOver")).toBe(true);
  });

  it("marks Grabby Pants being earned and changing hands", () => {
    // Ana is down on fives and Ben on nines. Ben feeds Ana fives three times, then
    // Ana feeds Ben nines four times — her drawing in between does not break his run.
    const ana = player({
      isDown: true,
      melds: [meld("5", cards("5", 3, "diamonds"))],
      hand: cards("9", 8, "spades"),
    });
    const ben = player({
      isDown: true,
      melds: [meld("9", cards("9", 3, "diamonds"))],
      hand: cards("5", 8, "hearts"),
    });
    const start = table([ana, ben], { discard: [card("5", "clubs")] });
    const anaTakes: Intent[] = [
      { type: "takePile" },
      { type: "meldPicked", rank: "5" },
      { type: "discardRank", rank: "9" },
    ];
    const benFeeds: Intent[] = [{ type: "draw" }, { type: "discardRank", rank: "5" }];
    const benTakes: Intent[] = [
      { type: "takePile" },
      { type: "meldPicked", rank: "9" },
      { type: "discardRank", rank: "5" },
    ];
    const anaFeeds: Intent[] = [{ type: "draw" }, { type: "discardRank", rank: "9" }];
    const actions = play(start, [
      ...anaTakes,
      ...benFeeds,
      ...anaTakes,
      ...benFeeds,
      ...anaTakes,
      ...benTakes,
      ...anaFeeds,
      ...benTakes,
      ...anaFeeds,
      ...benTakes,
      ...anaFeeds,
      ...benTakes,
    ]);
    const timeline = buildTimeline({
      config: EAST_COAST,
      setup: { state: start },
      actions,
      names: ["Ana", "Ben"],
    });
    const grabby = timeline.moments.filter((m) => m.kind === "grabbyPants");
    expect(grabby.map((m) => m.label)).toEqual([
      "Ana is Grabby Pants",
      "Ben takes Grabby Pants from Ana",
    ]);
    // Earned with the third take, and at that step the holder is Ana.
    expect(timeline.entry(grabby[0]!.step).action.type).toBe("takePile");
    expect(timeline.grabbyAt(grabby[0]!.step)).toEqual({ seat: 0, streak: 3 });
    expect(timeline.grabbyAt(grabby[0]!.step - 1)).toBeNull();
    expect(timeline.grabbyAt(timeline.length)).toEqual({ seat: 1, streak: 4, from: 0 });
  });
});

describe("Grabby Pants kept", () => {
  it("is marked once, not again each time the holder extends the streak", () => {
    const ana = player({
      isDown: true,
      melds: [meld("5", cards("5", 3, "diamonds"))],
      hand: cards("9", 8, "spades"),
    });
    const ben = player({ hand: cards("5", 8, "hearts") });
    const start = table([ana, ben], { discard: [card("5", "clubs")] });
    const lap: Intent[] = [
      { type: "takePile" },
      { type: "meldPicked", rank: "5" },
      { type: "discardRank", rank: "9" },
      { type: "draw" },
      { type: "discardRank", rank: "5" },
    ];
    const actions = play(start, [...lap, ...lap, ...lap, ...lap, ...lap]);
    const timeline = buildTimeline({ config: EAST_COAST, setup: { state: start }, actions });
    expect(timeline.grabbyAt(timeline.length)).toEqual({ seat: 0, streak: 5 });
    expect(timeline.moments.filter((m) => m.kind === "grabbyPants")).toHaveLength(1);
  });
});

describe("named moments", () => {
  const start = table([player({ hand: [card("9")] }), player({})]);
  const actions: Action[] = [{ type: "draw" }];

  it("sit among the found ones by step, ahead of anything else at the same step", () => {
    const timeline = buildTimeline({
      config: EAST_COAST,
      setup: { state: start },
      actions: play(start, [{ type: "draw" }, { type: "discardRank", rank: "9" }]),
      moments: [
        { id: "late", label: "Late", step: 2 },
        { id: "first", label: "First", step: 0 },
      ],
    });
    expect(timeline.moments.map((m) => m.id)).toEqual(["first", "late"]);
    expect(timeline.moments[0]).toEqual({ id: "first", kind: "named", label: "First", step: 0 });
  });

  it("are refused outside the game, or marked twice", () => {
    const at = (step: number, id = "x"): GameLog => ({
      config: EAST_COAST,
      setup: { state: start },
      actions,
      moments: [{ id, label: id, step }],
    });
    expect(() => buildTimeline(at(2))).toThrow(/outside 0\.\.1/);
    expect(() => buildTimeline(at(-1))).toThrow(TimelineError);
    expect(() => buildTimeline(at(0.5))).toThrow(TimelineError);
    expect(() =>
      buildTimeline({
        ...at(0),
        moments: [
          { id: "x", label: "a", step: 0 },
          { id: "x", label: "b", step: 1 },
        ],
      }),
    ).toThrow(/marked twice/);
  });
});

describe("a log the engine will not play", () => {
  it("is refused at the first illegal action, naming the step", () => {
    const start = table([player({ hand: [card("9")] }), player({})]);
    try {
      buildTimeline({
        config: EAST_COAST,
        setup: { state: start },
        actions: [{ type: "draw" }, { type: "draw" }],
        names: ["Ana"],
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TimelineError);
      expect((error as TimelineError).step).toBe(2);
      expect((error as Error).message).toMatch(/^action 2 \(draw by Ana\) was refused: /);
    }
  });

  it("answers no step outside the game", () => {
    const timeline = buildTimeline({
      config: EAST_COAST,
      setup: { seed: 1, playerCount: 2 },
      actions: [],
    });
    expect(timeline.turns).toEqual([]);
    expect(timeline.rounds).toEqual([{ number: 1, start: 0, end: 0 }]);
    expect(() => timeline.stateAt(1)).toThrow(RangeError);
    expect(() => timeline.stateAt(-1)).toThrow(RangeError);
    expect(() => timeline.entry(0)).toThrow(/setup/);
    expect(() => timeline.grabbyAt(2)).toThrow(RangeError);
  });
});
