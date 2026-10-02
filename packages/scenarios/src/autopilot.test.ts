import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type GameState } from "@hf/shared";
import { applyAction, deal } from "@hf/engine";
import { arrange } from "./arrange";
import { autopilotAction } from "./autopilot";

const BOOKS = { K: "KC KD KH KS KC KD KH", Q: "QC QD QH QS QC QD 2C", J: "JC JD JH JS JC JD JK" };

function playing(spec: Parameters<typeof arrange>[0]): GameState {
  return arrange({ phase: "play", ...spec }, EAST_COAST);
}

describe("the scenario autopilot", () => {
  it("only ever plays moves the engine accepts, over many games", () => {
    for (const players of [2, 3, 4]) {
      for (const seed of [1, 5, 9]) {
        let state = deal(players, EAST_COAST, seed);
        for (let i = 0; i < 400 && !state.roundEnded; i++) {
          const action = autopilotAction(state)!;
          const r = applyAction(state, action);
          expect(r.ok, `${players}p seed ${seed} step ${i}: ${JSON.stringify(action)}`).toBe(true);
          if (r.ok) state = r.state;
        }
      }
    }
  });

  it("has nothing to play once the round is over", () => {
    expect(autopilotAction({ ...deal(2, EAST_COAST, 1), roundEnded: true })).toBeNull();
  });

  it("takes the pile when it can, and draws otherwise", () => {
    const can = arrange(
      { seed: 1, seats: [{ melds: { J: "JC JD JH" }, hand: "4C" }, {}], discard: "JS" },
      EAST_COAST,
    );
    expect(autopilotAction(can)).toEqual({ type: "takePile" });
    const cannot = arrange({ seed: 1, seats: [{ hand: "4C" }, {}], discard: "JS" }, EAST_COAST);
    expect(autopilotAction(cannot)).toEqual({ type: "draw" });
  });

  it("goes out when melding its last cards would", () => {
    const state = playing({
      seed: 1,
      seats: [{ inFoot: true, melds: { ...BOOKS, "7": "7C 7D 7H" }, foot: "7S" }, {}],
    });
    const action = autopilotAction(state)! as Extract<Action, { type: "playMelds" }>;
    expect(action.type).toBe("playMelds");
    const r = applyAction(state, action);
    expect(r.ok && r.state.wentOutSeat).toBe(0);
  });

  it("keeps a card back rather than shed its last one without the books", () => {
    const state = playing({
      seed: 1,
      seats: [{ inFoot: true, melds: { K: "KC KD KH", Q: "QC QD QH" }, foot: "KS QS" }, {}],
    });
    const action = autopilotAction(state)! as Extract<Action, { type: "playMelds" }>;
    expect(action.type).toBe("playMelds");
    expect(action.melds.flatMap((m) => m.cardIds)).toHaveLength(1);
  });

  it("melds seven black threes from the foot as a book", () => {
    const state = playing({
      seed: 1,
      // Seven black threes need four decks, so three seats.
      seats: [{ inFoot: true, melds: BOOKS, foot: "3C 3S 3C 3S 3C 3S 3C 9D 8H" }, {}, {}],
    });
    const action = autopilotAction(state)! as Extract<Action, { type: "playMelds" }>;
    expect(action.type).toBe("playMelds");
    expect(action.melds.map((m) => m.rank)).toEqual(["3"]);
  });

  it("discards instead when no play would leave it a card", () => {
    const state = playing({
      seed: 1,
      seats: [{ inFoot: true, melds: { K: "KC KD KH" }, foot: "7C 7D 7H" }, {}],
    });
    expect(autopilotAction(state)!.type).toBe("discard");
  });

  it("puts a wild towards a book, keeping its biggest clean meld clean while it needs one", () => {
    const state = playing({
      seed: 1,
      seats: [{ melds: { K: "KC KD KH KS KC", Q: "QC QD QH QS" }, hand: "2C 4D 9S" }, {}],
    });
    const action = autopilotAction(state)! as Extract<Action, { type: "playMelds" }>;
    expect(action.melds).toEqual([{ rank: "Q", cardIds: [expect.any(String)] }]);
  });
});
