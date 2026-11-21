import { describe, expect, it } from "vitest";
import type { OpponentView, RoomPlayerInfo } from "@hf/shared";
import { seatLine } from "./OpponentStrip";

const opponent = (inFoot = false): OpponentView => ({
  seat: 1,
  handCount: inFoot ? 0 : 11,
  footCount: inFoot ? 9 : 14,
  melds: [],
  isDown: inFoot,
  inFoot,
});
const person = (connected = true): RoomPlayerInfo => ({ seat: 1, name: "ben", connected });

describe("what a seat is doing", () => {
  it("is their clock on their turn, and never their count", () => {
    // The count is on the backs beside the line, so the clock cannot cover it.
    expect(seatLine(opponent(), person(), true, "0:41")).toEqual({
      text: "Playing · 0:41",
      tone: "turn",
    });
    expect(seatLine(opponent(true), person(), true, "0:41").text).toBe("Playing · 0:41");
    expect(seatLine(opponent(), person(), true, null).text).toBe("Playing");
  });

  it("says when they play from the foot, and otherwise that they are waiting", () => {
    expect(seatLine(opponent(true), person(), false, "0:41")).toEqual({
      text: "In the foot",
      tone: "plain",
    });
    expect(seatLine(opponent(), person(), false, "0:41")).toEqual({
      text: "Waiting",
      tone: "plain",
    });
    expect(seatLine(opponent(), undefined, false, null).text).toBe("Waiting");
  });

  it("says a person dropped, even on their turn, but never a computer", () => {
    expect(seatLine(opponent(), person(false), true, "0:41")).toEqual({
      text: "Reconnecting",
      tone: "warn",
    });
    expect(seatLine(opponent(), { ...person(false), bot: true }, true, "0:41").text).toBe(
      "Playing · 0:41",
    );
  });
});
