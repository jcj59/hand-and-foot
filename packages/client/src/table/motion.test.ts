import { describe, it, expect } from "vitest";
import type { LastMove } from "@hf/shared";
import { planMotion, type Box } from "./motion";

const at = (x: number, y: number): Box => ({ x, y, w: 56, h: 80 });
const anchors = new Map<string, Box>([
  ["stock", at(100, 100)],
  ["discard", at(200, 100)],
  ["seat-1", at(300, 0)],
]);
const me = 0;
const move = (over: Partial<LastMove> & Pick<LastMove, "kind">): LastMove => ({
  seq: 1,
  seat: me,
  ...over,
});

describe("planning card movement", () => {
  it("slides a card the player discarded from their hand to the pile", () => {
    const plans = planMotion(
      move({ kind: "discard" }),
      me,
      new Map([["c1", at(50, 500)]]),
      new Map([["c1", at(200, 100)]]),
      anchors,
    );
    expect(plans).toEqual([{ kind: "slide", id: "c1", from: at(50, 500), reveal: false }]);
  });

  it("lifts the player's own draw from the stock, to be shown before it goes in the hand", () => {
    const plans = planMotion(
      move({ kind: "draw", card: { id: "new", rank: "7", suit: "hearts" } }),
      me,
      new Map([["old", at(50, 500)]]),
      new Map([
        ["old", at(50, 500)],
        ["new", at(110, 500)],
      ]),
      anchors,
    );
    // The card already held has not moved enough to count; only the new one flies.
    expect(plans).toEqual([{ kind: "slide", id: "new", from: at(100, 100), reveal: true }]);
  });

  it("brings the pile into the hand when the player takes it", () => {
    const plans = planMotion(
      move({ kind: "takePile", count: 2 }),
      me,
      new Map([["top", at(200, 100)]]),
      new Map([
        ["top", at(50, 500)],
        ["under", at(110, 500)],
      ]),
      anchors,
    );
    expect(plans).toEqual([
      { kind: "slide", id: "top", from: at(200, 100), reveal: false },
      { kind: "slide", id: "under", from: at(200, 100), reveal: false },
    ]);
  });

  it("brings another player's discard and melds from their seat", () => {
    const discard = planMotion(
      move({ kind: "discard", seat: 1 }),
      me,
      new Map(),
      new Map([["theirs", at(200, 100)]]),
      anchors,
    );
    expect(discard).toEqual([{ kind: "slide", id: "theirs", from: at(300, 0), reveal: false }]);
    const meld = planMotion(
      move({ kind: "meld", seat: 1 }),
      me,
      new Map(),
      new Map([["laid", at(320, 40)]]),
      anchors,
    );
    expect(meld).toEqual([{ kind: "slide", id: "laid", from: at(300, 0), reveal: false }]);
  });

  it("sends a card back to another player's seat for a draw or pickup it cannot show", () => {
    expect(planMotion(move({ kind: "draw", seat: 1 }), me, new Map(), new Map(), anchors)).toEqual([
      { kind: "ghost", from: at(100, 100), to: at(300, 0), cards: 1 },
    ]);
    expect(
      planMotion(move({ kind: "takePile", seat: 1, count: 9 }), me, new Map(), new Map(), anchors),
    ).toEqual([{ kind: "ghost", from: at(200, 100), to: at(300, 0), cards: 3 }]);
  });

  it("leaves alone cards nudged by the layout, and new cards the move does not explain", () => {
    const plans = planMotion(
      move({ kind: "meld" }),
      me,
      new Map([["nudged", at(50, 500)]]),
      new Map([
        ["nudged", at(58, 500)],
        ["unexplained", at(10, 10)],
      ]),
      anchors,
    );
    expect(plans).toEqual([]);
  });

  it("sends no ghost for a seat with no anchor on the page", () => {
    expect(planMotion(move({ kind: "draw", seat: 4 }), me, new Map(), new Map(), anchors)).toEqual(
      [],
    );
  });
});
