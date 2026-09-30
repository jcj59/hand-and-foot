import { describe, it, expect } from "vitest";
import { EAST_COAST, type Action, type LoggedAction } from "@hf/shared";
import { FakeClock } from "./clock";
import { InMemoryActionLog } from "./log";
import { Room } from "./room";
import { GRABBY_STREAK, grabbyPants } from "./grabby";

let seq = 0;
/** A log of moves, each `[seat, "take" | "draw" | "discard"]`. */
function log(...moves: [number, "take" | "draw" | "discard"][]): LoggedAction[] {
  return moves.map(([seat, kind]) => {
    const action: Action =
      kind === "take"
        ? { type: "takePile" }
        : kind === "draw"
          ? { type: "draw" }
          : { type: "discard", cardId: "x" };
    return { seq: seq++, seat, action, source: "player", at: 0 };
  });
}
/** Seat `seat` takes the pile `n` times, with the others only drawing in between. */
function takes(seat: number, n: number, others = 1): [number, "take" | "draw"][] {
  return Array.from({ length: n }, (_, i) => [
    [seat, "take"] as [number, "take"],
    ...(i < n - 1 ? [[(seat + others) % 4, "draw"] as [number, "draw"]] : []),
  ]).flat();
}

describe("Grabby Pants", () => {
  it("goes to whoever takes the pile three times running", () => {
    // Pinned as a literal: the table's rule.
    expect(GRABBY_STREAK).toBe(3);
    expect(grabbyPants(log(...takes(1, 2)))).toBeNull();
    expect(grabbyPants(log(...takes(1, 3)))).toEqual({ seat: 1, streak: 3 });
  });

  it("is not broken by others drawing and discarding, only by someone else taking the pile", () => {
    expect(
      grabbyPants(
        log([1, "take"], [2, "draw"], [2, "discard"], [1, "take"], [0, "draw"], [1, "take"]),
      ),
    ).toEqual({ seat: 1, streak: 3 });
    expect(grabbyPants(log([1, "take"], [1, "take"], [2, "take"], [1, "take"]))).toBeNull();
  });

  it("must be taken with a longer streak than the holder's best", () => {
    // Ana holds it at 3; Ben matching 3 is not enough, and 4 takes it.
    const matched = log(...takes(0, 3), ...takes(1, 3));
    expect(grabbyPants(matched)).toEqual({ seat: 0, streak: 3 });
    const beaten = log(...takes(0, 3), ...takes(1, 4));
    expect(grabbyPants(beaten)).toEqual({ seat: 1, streak: 4, from: 0 });
  });

  it("raises the bar when the holder extends their own streak", () => {
    expect(grabbyPants(log(...takes(2, 5)))).toEqual({ seat: 2, streak: 5 });
    // Five is now what has to be beaten: a later four does not take it.
    expect(grabbyPants(log(...takes(2, 5), ...takes(3, 4)))).toEqual({ seat: 2, streak: 5 });
  });

  it("keeps the holder's best when they start a shorter streak later", () => {
    expect(grabbyPants(log(...takes(1, 5), [2, "take"], ...takes(1, 3)))).toEqual({
      seat: 1,
      streak: 5,
    });
  });

  it("keeps the title with its holder after the streak ends", () => {
    expect(grabbyPants(log(...takes(1, 3), [2, "take"], [3, "take"]))).toEqual({
      seat: 1,
      streak: 3,
    });
  });
});

describe("Grabby Pants at the table", () => {
  it("is told to every seat with the room", () => {
    const room = new Room("GRABBY", EAST_COAST, {
      clock: new FakeClock(0),
      seed: 1,
      newToken: () => "t",
      log: new InMemoryActionLog(log(...takes(1, 3))),
    });
    expect(room.info().grabbyPants).toEqual({ seat: 1, streak: 3 });
    const quiet = new Room("QUIET1", EAST_COAST, {
      clock: new FakeClock(0),
      seed: 1,
      newToken: () => "t",
    });
    expect(quiet.info().grabbyPants).toBeNull();
  });
});
