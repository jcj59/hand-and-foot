import { describe, it, expect } from "vitest";
import { isRedThree, isWild, type GameState, type PlayerState } from "@hf/shared";
import { buildTimeline, cardValue, scoreRound, type Timeline } from "@hf/engine";
import { SCENARIOS, scenarioById } from "./library";
import { buildScenario } from "./scenario";

const timelines = new Map<string, Timeline>(
  SCENARIOS.map((s) => [s.id, buildTimeline(buildScenario(s))]),
);
function timeline(id: string): Timeline {
  return timelines.get(id)!;
}
/** The state at a named moment. */
function at(id: string, momentId: string): GameState {
  const t = timeline(id);
  const m = t.moments.find((x) => x.kind === "named" && x.id === momentId);
  if (!m) throw new Error(`${id} has no moment ${momentId}`);
  return t.stateAt(m.step);
}
function step(id: string, momentId: string): number {
  return timeline(id).moments.find((x) => x.id === momentId)!.step;
}
const zone = (p: PlayerState) => (p.inFoot ? p.foot : p.hand);
const kinds = (id: string) => timeline(id).moments.map((m) => m.kind);

describe("the scenario library", () => {
  it("has unique ids that work in a URL, and something to say about each", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(20);
      expect(scenarioById(s.id)).toBe(s);
    }
    expect(scenarioById("no-such-scenario")).toBeUndefined();
  });

  // Building the timeline replays every action; a scenario whose script the engine
  // no longer accepts fails here, by name.
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s replays to the end", (id, s) => {
    const t = timeline(id);
    expect(t.length).toBeGreaterThan(0);
    expect(t.stateAt(t.length)).toBeDefined();
    // Every moment the script marked survives into the timeline.
    const named = s.script.filter((x) => x.do === "moment").length;
    expect(t.moments.filter((m) => m.kind === "named")).toHaveLength(named);
    expect(s.watch ?? 0).toBeLessThan(t.playerCount);
  });

  it("covers every situation the roadmap lists", () => {
    const ids = SCENARIOS.map((s) => s.id);
    for (const id of [
      "ordinary-turns",
      "getdown-round-1",
      "getdown-round-2",
      "getdown-round-3",
      "getdown-round-4",
      "pile-natural-pair",
      "pile-pair-wild",
      "pile-extend-meld",
      "threes",
      "black-three-book",
      "marva",
      "foot-with-discard",
      "foot-without-discard",
      "wild-take-back",
      "shed-all",
      "go-out-final-lap",
      "stock-reshuffle",
      "grabby-pants",
      "pile-black-three",
      "match",
      "player-leaves",
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe("each scenario shows what it says", () => {
  it("ordinary turns: a lay-down and a meld extended", () => {
    const down = at("ordinary-turns", "getdown").players[0]!;
    expect(down.isDown).toBe(true);
    expect(down.melds.map((m) => m.rank).sort()).toEqual(["A", "K"]);
    const kings = at("ordinary-turns", "layoff").players[0]!.melds.find((m) => m.rank === "K")!;
    expect(kings.cards).toHaveLength(4);
  });

  it.each([1, 2, 3, 4])("getting down in round %i reaches that round's minimum", (round) => {
    const id = `getdown-round-${round}`;
    // An ordinary get-down is no Marva, even with the rule on.
    expect(timeline(id).moments.some((m) => m.kind === "marva")).toBe(false);
    const before = timeline(id).stateAt(step(id, "getdown") - 1);
    const after = at(id, "getdown");
    expect(after.roundNumber).toBe(round);
    expect(before.players[0]!.isDown).toBe(false);
    expect(after.players[0]!.isDown).toBe(true);
    const cards = after.players[0]!.melds.flatMap((m) => m.cards);
    const value = cards.reduce((sum, c) => sum + cardValue(c, after.config), 0);
    const minimum = after.config.layDownMinimums[round - 1]!;
    if (round === 4) {
      // Under the minimum in cards: the clean book's bonus is what gets her down.
      expect(value).toBeLessThan(minimum);
      expect(after.players[0]!.melds[0]!.cards).toHaveLength(7);
    } else {
      expect(value).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("the Marva rule: down for less than the minimum, by emptying the hand", () => {
    const state = at("marva", "getdown");
    const ana = state.players[0]!;
    expect(state.config.marvaRule).toBe(true);
    // The engine's own verdict, which the celebration follows.
    const t = timeline("marva");
    expect(t.entry(step("marva", "getdown")).move?.marva).toBe(true);
    expect(t.moments.find((m) => m.kind === "marva")?.step).toBe(step("marva", "getdown"));
    expect(ana.isDown).toBe(true);
    expect(ana.inFoot).toBe(true);
    const value = ana.melds[0]!.cards.reduce((sum, c) => sum + cardValue(c, state.config), 0);
    expect(value).toBeLessThan(state.config.layDownMinimums[0]!);
  });

  it.each(["pile-natural-pair", "pile-pair-wild", "pile-extend-meld"])(
    "%s: the pile is taken and owed for",
    (id) => {
      expect(timeline(id).entry(step(id, "taken")).action.type).toBe("takePile");
      expect(at(id, "taken").players[0]!.pickedUp!.length).toBeGreaterThan(0);
      expect(kinds(id)).toContain("pileTaken");
    },
  );

  it("the pile obligation is settled by playing a card from it", () => {
    expect(at("pile-natural-pair", "settled").players[0]!.pickedUp).toEqual([]);
    const melded = at("pile-pair-wild", "taken");
    expect(zone(melded.players[0]!).filter((c) => isWild(c.rank))).toHaveLength(1);
  });

  it("threes: Ben holds two red threes when Cal goes out, and pays for both", () => {
    const drawn = timeline("threes").entry(step("threes", "drawn")).move!;
    expect(drawn.card && isRedThree(drawn.card)).toBe(true);
    const end = at("threes", "out");
    expect(end.roundEnded).toBe(true);
    expect(end.wentOutSeat).toBe(2);
    expect(zone(end.players[1]!).filter(isRedThree)).toHaveLength(2);
    expect(scoreRound(end)[1]!.breakdown.heldPenalty).toBeLessThanOrEqual(-1000);
    const thrown = timeline("threes").entry(step("threes", "black")).action;
    expect(thrown.type).toBe("discard");
  });

  it("a book of black threes, from the foot, then out", () => {
    const ana = at("black-three-book", "book").players[0]!;
    expect(ana.melds.find((m) => m.rank === "3")!.cards).toHaveLength(7);
    const t = timeline("black-three-book");
    expect(t.stateAt(t.length).wentOutSeat).toBe(0);
  });

  it("the foot after a discard is picked up when the turn comes back", () => {
    const t = timeline("foot-with-discard");
    expect(at("foot-with-discard", "pending").players[0]!.footPending).toBe(true);
    const pickup = t.moments.find((m) => m.kind === "footPickedUp" && m.seat === 0)!;
    expect(pickup.step).toBeGreaterThan(step("foot-with-discard", "pending"));
    // Picked up as the turn reached her: the step was someone else's discard.
    expect(t.entry(pickup.step).seat).not.toBe(0);
  });

  it("the foot by melding is picked up mid-turn, by her own play", () => {
    const t = timeline("foot-without-discard");
    const pickup = t.moments.find((m) => m.kind === "footPickedUp" && m.seat === 0)!;
    expect(pickup.step).toBe(step("foot-without-discard", "pickup"));
    expect(t.entry(pickup.step).seat).toBe(0);
  });

  it("a wild is placed, taken back, and placed elsewhere", () => {
    const wildOn = (s: GameState, rank: string) =>
      s.players[0]!.melds.find((m) => m.rank === rank)!.cards.some((c) => isWild(c.rank));
    expect(wildOn(at("wild-take-back", "placed"), "8")).toBe(true);
    expect(wildOn(at("wild-take-back", "taken-back"), "8")).toBe(false);
    const t = timeline("wild-take-back");
    expect(wildOn(t.stateAt(t.length), "J")).toBe(true);
  });

  it("shedding every card is not going out, and the pile digs a cardless player back in", () => {
    const shed = at("shed-all", "cardless");
    expect(zone(shed.players[0]!)).toHaveLength(0);
    expect(shed.wentOutSeat).toBeUndefined();
    expect(shed.roundEnded).toBeFalsy();
    expect(timeline("shed-all").entry(step("shed-all", "dig")).action.type).toBe("takePile");
    expect(zone(at("shed-all", "dig").players[0]!).length).toBeGreaterThan(1);
  });

  it("going out by melding starts a final lap, and the round ends after it", () => {
    const t = timeline("go-out-final-lap");
    const out = at("go-out-final-lap", "out");
    expect(out.wentOutSeat).toBe(0);
    expect(out.roundEnded).toBeFalsy();
    expect(out.finalLapRemaining).toBe(2);
    expect(kinds("go-out-final-lap")).toEqual(expect.arrayContaining(["wentOut", "roundEnded"]));
    expect(t.stateAt(t.length).roundEnded).toBe(true);
  });

  it("the stock runs out and is reshuffled from the pile", () => {
    expect(at("stock-reshuffle", "empty").stock).toHaveLength(0);
    const after = at("stock-reshuffle", "reshuffled");
    expect(after.stock.length).toBeGreaterThan(10);
    expect(after.roundEnded).toBeFalsy();
  });

  it("Grabby Pants is earned, taken by another three in a row, and lapses at a new round", () => {
    const t = timeline("grabby-pants");
    const grabby = t.moments.filter((m) => m.kind === "grabbyPants");
    // The scripted part: earned, then taken with a run no longer than Ana's.
    expect(grabby.slice(0, 2).map((m) => m.label)).toEqual([
      "Ana is Grabby Pants",
      "Ben takes Grabby Pants from Ana",
    ]);
    expect(grabby[0]!.step).toBe(step("grabby-pants", "earned"));
    expect(grabby[1]!.step).toBe(step("grabby-pants", "taken"));
    expect(t.grabbyAt(step("grabby-pants", "kept"))).toEqual({ seat: 1, streak: 4, from: 0 });
    // Nobody holds it once the next round is dealt.
    const lapsed = step("grabby-pants", "lapsed");
    expect(t.stateAt(lapsed).roundNumber).toBe(2);
    expect(t.grabbyAt(lapsed - 1)).not.toBeNull();
    expect(t.grabbyAt(lapsed)).toBeNull();
  });

  it("a black three on the pile taken from the foot, and melded as a book of seven", () => {
    const offered = at("pile-black-three", "offered");
    expect(offered.discard.at(-1)).toMatchObject({ rank: "3", suit: "spades" });
    expect(offered.players[0]!.foot.filter((c) => c.rank === "3")).toHaveLength(6);
    expect(at("pile-black-three", "taken").phase).toBe("play");
    const book = at("pile-black-three", "book").players[0]!.melds.find((m) => m.rank === "3");
    expect(book?.cards).toHaveLength(7);
  });

  it("a player leaving between rounds: the next round dealt to the two left", () => {
    const leaving = at("player-leaves", "leaving");
    expect(leaving.roundEnded).toBe(true);
    expect(leaving.players[1]!.hand.length + leaving.players[1]!.melds.length).toBeGreaterThan(0);
    const smaller = at("player-leaves", "smaller");
    expect(smaller.roundNumber).toBe(2);
    expect(smaller.departed).toEqual([{ seat: 1, afterRound: 1 }]);
    expect(smaller.players[1]!.hand).toEqual([]);
    expect(smaller.players[1]!.foot).toEqual([]);
    expect(smaller.currentSeat).toBe(2);
    expect(kinds("player-leaves")).toContain("playerLeft");
    // Ben's round 1 is kept, and he never plays in round 2.
    const t = timeline("player-leaves");
    const end = t.stateAt(t.length);
    expect(end.roundEnded).toBe(true);
    expect(end.pastRounds![0]![1]!.score).not.toBe(0);
    const round2 = t.turns.filter((turn) => turn.round === 2);
    expect(round2.length).toBeGreaterThan(0);
    expect(round2.some((turn) => turn.seat === 1)).toBe(false);
  });

  it("a whole match: four rounds dealt and scored, and the match over", () => {
    const t = timeline("match");
    expect(t.rounds.map((r) => r.number)).toEqual([1, 2, 3, 4]);
    expect(kinds("match").filter((k) => k === "roundEnded")).toHaveLength(4);
    expect(kinds("match")).toContain("matchOver");
    // A seeded deal stays a seed, the way a recorded match would be stored.
    expect(buildScenario(scenarioById("match")!).setup).toEqual({ seed: 2, playerCount: 2 });
  });
});
