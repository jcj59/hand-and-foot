import { describe, it, expect } from "vitest";
import type { Action } from "@hf/shared";
import { GRABBY_STREAK, grabbyHistory, grabbyPants, type SeatedAction } from "./grabby";

/** A log of moves, each `[seat, "take" | "draw" | "discard"]`. */
function log(...moves: [number, "take" | "draw" | "discard"][]): SeatedAction[] {
  return moves.map(([seat, kind]) => {
    const action: Action =
      kind === "take"
        ? { type: "takePile" }
        : kind === "draw"
          ? { type: "draw" }
          : { type: "discard", cardId: "x" };
    return { seat, action };
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

describe("Grabby Pants over the course of a match", () => {
  it("gives the holder after every prefix of the log", () => {
    const moves = log(...takes(0, 3), ...takes(1, 4));
    const history = grabbyHistory(moves);
    expect(history).toHaveLength(moves.length + 1);
    expect(history[0]).toBeNull();
    // Every entry agrees with working the title out from that prefix alone.
    history.forEach((holder, k) => expect(holder).toEqual(grabbyPants(moves.slice(0, k))));
    // Earned on the third take (the fifth action), and taken on Ben's fourth.
    expect(history[4]).toBeNull();
    expect(history[5]).toEqual({ seat: 0, streak: 3 });
    expect(history.at(-1)).toEqual({ seat: 1, streak: 4, from: 0 });
  });
});
