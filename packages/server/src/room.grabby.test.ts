import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type LoggedAction } from "@hf/shared";
import { FakeClock } from "./clock";
import { InMemoryActionLog } from "./log";
import { Room } from "./room";

/** Seat `seat` takes the pile `n` times, with another seat drawing in between. */
function takes(seat: number, n: number): LoggedAction[] {
  const actions: [number, Action][] = [];
  for (let i = 0; i < n; i++) {
    actions.push([seat, { type: "takePile" }]);
    if (i < n - 1) actions.push([(seat + 1) % 4, { type: "draw" }]);
  }
  return actions.map(([s, action], seq) => ({ seq, seat: s, action, source: "player", at: 0 }));
}

describe("Grabby Pants at the table", () => {
  it("is told to every seat with the room", () => {
    const room = new Room("GRABBY", EAST_COAST, {
      clock: new FakeClock(0),
      seed: 1,
      newToken: () => "t",
      log: new InMemoryActionLog(takes(1, 3)),
    });
    expect(room.info().grabbyPants).toEqual({ seat: 1, streak: 3 });
    const quiet = new Room("QUIET1", EAST_COAST, {
      clock: new FakeClock(0),
      seed: 1,
      newToken: () => "t",
    });
    expect(quiet.info().grabbyPants).toBeNull();
  });

  it("lapses when the room's log reaches the next round", () => {
    const log = [...takes(1, 3)];
    log.push({ seq: log.length, seat: 0, action: { type: "nextRound" }, source: "player", at: 0 });
    const room = new Room("LAPSED", EAST_COAST, {
      clock: new FakeClock(0),
      seed: 1,
      newToken: () => "t",
      log: new InMemoryActionLog(log),
    });
    expect(room.info().grabbyPants).toBeNull();
  });
});
