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

  it("changes hands on anyone else's three in a row, with no longer streak needed", () => {
    // Until P1 Ben's matching three was not enough; now three is all it takes.
    const matched = log(...takes(0, 3), ...takes(1, 3));
    expect(grabbyPants(matched)).toEqual({ seat: 1, streak: 3, from: 0 });
    // And it can come straight back the same way.
    const back = log(...takes(0, 3), ...takes(1, 3), ...takes(0, 3));
    expect(grabbyPants(back)).toEqual({ seat: 0, streak: 3, from: 1 });
  });

  it("is not taken by fewer than three, however long the holder's run was", () => {
    expect(grabbyPants(log(...takes(2, 5), ...takes(3, 2)))).toEqual({ seat: 2, streak: 5 });
  });

  it("stays with a holder who keeps taking the pile, counting the run up", () => {
    expect(grabbyPants(log(...takes(2, 4)))).toEqual({ seat: 2, streak: 4 });
    // Earned, lost and won back: the run counts up from the third take again.
    expect(grabbyPants(log(...takes(1, 3), ...takes(2, 3), ...takes(1, 4)))).toEqual({
      seat: 1,
      streak: 4,
      from: 2,
    });
  });

  it("stays with its holder through a shorter run of their own later", () => {
    expect(grabbyPants(log(...takes(1, 5), [2, "take"], ...takes(1, 3)))).toEqual({
      seat: 1,
      streak: 3,
    });
  });

  it("keeps the title with its holder after the streak ends", () => {
    expect(grabbyPants(log(...takes(1, 3), [2, "take"], [3, "take"]))).toEqual({
      seat: 1,
      streak: 3,
    });
  });
});

describe("Grabby Pants round by round", () => {
  const nextRound: SeatedAction = { seat: 0, action: { type: "nextRound" } };

  it("lapses at the start of every round", () => {
    expect(grabbyPants([...log(...takes(1, 3)), nextRound])).toBeNull();
  });

  it("carries no streak over the round boundary", () => {
    // Two at the end of one round and one at the start of the next are not three.
    expect(grabbyPants([...log(...takes(1, 2)), nextRound, ...log([1, "take"])])).toBeNull();
    expect(grabbyPants([...log(...takes(1, 2)), nextRound, ...log(...takes(1, 3))])).toEqual({
      seat: 1,
      streak: 3,
    });
  });

  it("is earned afresh in a later round, from nobody, whoever held it before", () => {
    expect(grabbyPants([...log(...takes(1, 3)), nextRound, ...log(...takes(2, 3))])).toEqual({
      seat: 2,
      streak: 3,
    });
    expect(grabbyPants([...log(...takes(1, 3)), nextRound, ...log(...takes(1, 3))])).toEqual({
      seat: 1,
      streak: 3,
    });
  });
});

describe("Grabby Pants over the course of a match", () => {
  it("gives the holder after every prefix of the log", () => {
    const moves = log(...takes(0, 3), ...takes(1, 3));
    const history = grabbyHistory(moves);
    expect(history).toHaveLength(moves.length + 1);
    expect(history[0]).toBeNull();
    // Every entry agrees with working the title out from that prefix alone.
    history.forEach((holder, k) => expect(holder).toEqual(grabbyPants(moves.slice(0, k))));
    // Earned on the third take (the fifth action), and taken on Ben's third.
    expect(history[4]).toBeNull();
    expect(history[5]).toEqual({ seat: 0, streak: 3 });
    expect(history.at(-2)).toEqual({ seat: 0, streak: 3 });
    expect(history.at(-1)).toEqual({ seat: 1, streak: 3, from: 0 });
  });
});
