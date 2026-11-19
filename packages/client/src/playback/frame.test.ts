import { describe, it, expect } from "vitest";
import { EAST_COAST, type Card } from "@hf/shared";
import { buildTimeline, seatTallies } from "@hf/engine";
import { recordRich } from "@hf/engine/testing";
import { SCENARIOS, buildScenario } from "@hf/scenarios";
import { frameAt } from "./frame";

const { actions } = recordRich(58, 4, 150);
const timeline = buildTimeline({
  config: EAST_COAST,
  setup: { seed: 58, playerCount: 4 },
  actions,
  names: ["Ana", "Ben", "Cal", "Dee"],
});

/** Every card a seat could not see at a real table at this step. */
function hiddenFrom(step: number, seat: number): Card[] {
  const state = timeline.stateAt(step);
  return [
    ...state.stock,
    ...state.players.flatMap((p, s) =>
      s === seat ? (p.inFoot ? [] : p.foot) : [...p.hand, ...p.foot],
    ),
  ];
}

describe("a replayed step, as one seat sees it", () => {
  it("never carries a card that seat could not see, at any step", () => {
    for (let step = 0; step <= timeline.length; step++) {
      for (let seat = 0; seat < 4; seat++) {
        const frame = JSON.stringify(frameAt(timeline, step, seat, step));
        for (const card of hiddenFrom(step, seat)) {
          expect(frame.includes(`"${card.id}"`), `step ${step} seat ${seat} shows ${card.id}`).toBe(
            false,
          );
        }
      }
    }
  });

  it("names a drawn card to its drawer only", () => {
    const step = actions.findIndex((a) => a.type === "draw") + 1;
    const drawer = timeline.entry(step).seat;
    const own = frameAt(timeline, step, drawer, 7).update.lastMove!;
    expect(own).toMatchObject({ seq: 7, kind: "draw", seat: drawer });
    expect(own.card).toBeDefined();
    const other = frameAt(timeline, step, (drawer + 1) % 4, 7).update.lastMove!;
    expect(other).toEqual({ seq: 7, seat: drawer, kind: "draw" });
  });

  it("carries the move only when the step was played, numbered as played", () => {
    expect(frameAt(timeline, 5, 0, null).update.lastMove).toBeUndefined();
    expect(frameAt(timeline, 0, 0, 1).update.lastMove).toBeUndefined();
    expect(frameAt(timeline, 5, 0, 42).update.lastMove?.seq).toBe(42);
  });

  it("is the seat's own view, with that seat's options, and no clock", () => {
    const step = 9;
    const frame = frameAt(timeline, step, 2, null, "Golden game");
    const state = timeline.stateAt(step);
    expect(frame.update.view.seat).toBe(2);
    expect(frame.update.view.hand).toEqual(state.players[2]!.hand);
    expect(frame.update.hints.seatToAct).toBe(state.currentSeat);
    expect(frame.update.clock).toEqual({
      serverNow: 0,
      deadlineAt: null,
      inDiscardGrace: false,
      paused: false,
    });
    expect(frame.room.roomId).toBe("Golden game");
    expect(frame.room.players.map((p) => p.name)).toEqual(["Ana", "Ben", "Cal", "Dee"]);
    expect(frame.update.room).toBe(frame.room);
    expect(frame.result).toBeNull();
  });

  it("brings the scoreboard at the end of a round, and Grabby Pants once earned", () => {
    const grabby = buildTimeline(buildScenario(SCENARIOS.find((s) => s.id === "grabby-pants")!));
    const earned = grabby.moments.find((m) => m.kind === "grabbyPants")!;
    expect(frameAt(grabby, earned.step - 1, 0, null).room.grabbyPants).toBeNull();
    expect(frameAt(grabby, earned.step, 0, null).room.grabbyPants).toEqual({ seat: 0, streak: 3 });
    const out = buildTimeline(buildScenario(SCENARIOS.find((s) => s.id === "black-three-book")!));
    const result = frameAt(out, out.length, 1, null).result!;
    expect(result.wentOutSeat).toBe(0);
    expect(result.scores).toHaveLength(3);
  });

  it("brings the whole match's tallies with the final result, as the table sends for the awards", () => {
    const match = buildTimeline(buildScenario(SCENARIOS.find((s) => s.id === "match")!));
    const end = frameAt(match, match.length, 0, null).result!;
    expect(end.matchOver).toBe(true);
    expect(end.tallies).toEqual(seatTallies(match));
    const roundOne = match.rounds[0]!.end;
    expect(frameAt(match, roundOne, 0, null).result!.tallies).toBeUndefined();
  });

  it("turns every hand face up in the result at each round's end, and at no step before it", () => {
    const match = buildTimeline(buildScenario(SCENARIOS.find((s) => s.id === "match")!));
    let ends = 0;
    for (let step = 0; step <= match.length; step++) {
      const state = match.stateAt(step);
      for (let seat = 0; seat < match.playerCount; seat++) {
        const frame = frameAt(match, step, seat, step);
        // The view stays the seat's own, round over or not: no other seat's card in it.
        const view = JSON.stringify(frame.update);
        expect(view).not.toContain('"held"');
        for (const [s, p] of state.players.entries()) {
          if (s === seat) continue;
          for (const c of [...p.hand, ...p.foot]) expect(view).not.toContain(`"${c.id}"`);
        }
        if (!state.roundEnded) {
          expect(frame.result, `step ${step} has a result`).toBeNull();
          continue;
        }
        expect(frame.result!.held).toEqual(
          state.players.map((p, s) => ({
            seat: s,
            hand: p.hand,
            foot: p.foot,
            footUntouched: !p.inFoot,
          })),
        );
      }
      if (state.roundEnded) ends++;
    }
    // Every round of the match ended at a step, and each was checked.
    expect(match.rounds.length).toBe(match.stateAt(match.length).config.rounds);
    expect(ends).toBe(match.rounds.length);
  });

  it("marks a player who has left as departed, and shows no seat of theirs to the others", () => {
    const left = buildTimeline(buildScenario(SCENARIOS.find((s) => s.id === "player-leaves")!));
    const gone = left.moments.find((m) => m.kind === "playerLeft")!;
    expect(frameAt(left, gone.step - 1, 0, null).room.players[1]!.departed).toBeUndefined();
    const frame = frameAt(left, gone.step + 1, 0, null);
    expect(frame.room.players.map((p) => p.departed ?? false)).toEqual([false, true, false]);
    expect(frame.update.view.opponents.map((o) => o.seat)).toEqual([2]);
    expect(frameAt(left, left.length, 2, null).result!.departed).toEqual([
      { seat: 1, afterRound: 1 },
    ]);
  });
});
