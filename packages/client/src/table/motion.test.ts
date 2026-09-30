import { describe, it, expect } from "vitest";
import type { LastMove } from "@hf/shared";
import { planMotion, type Box, type Spot } from "./motion";

const at = (x: number, y: number): Box => ({ x, y, w: 56, h: 80 });
/** A card shown at (x, y) in `zone`, in view unless said otherwise. */
const spot = (x: number, y: number, zone = "hand", visible = true): Spot => ({
  ...at(x, y),
  zone,
  visible,
});
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
const none = new Map<string, Spot>();

describe("planning card movement", () => {
  it("slides a card the player discarded from their hand to the pile", () => {
    const plans = planMotion(
      move({ kind: "discard" }),
      me,
      new Map([["c1", spot(50, 500)]]),
      new Map([["c1", spot(200, 100, "pile")]]),
      anchors,
    );
    expect(plans).toEqual([{ kind: "slide", id: "c1", from: at(50, 500), reveal: false }]);
  });

  it("lifts the player's own draw from the stock, to be shown before it goes in the hand", () => {
    const plans = planMotion(
      move({ kind: "draw", card: { id: "new", rank: "7", suit: "hearts" } }),
      me,
      new Map([["old", spot(50, 500)]]),
      new Map([
        ["old", spot(50, 500)],
        ["new", spot(110, 500)],
      ]),
      anchors,
    );
    // The card already held has not moved enough to count; only the new one flies.
    expect(plans).toEqual([{ kind: "slide", id: "new", from: at(100, 100), reveal: true }]);
  });

  it("closes the hand up around a card that left it", () => {
    const plans = planMotion(
      move({ kind: "discard" }),
      me,
      new Map([["right", spot(170, 500)]]),
      new Map([["right", spot(110, 500)]]),
      anchors,
    );
    expect(plans).toEqual([{ kind: "slide", id: "right", from: at(170, 500), reveal: false }]);
  });

  it("brings the pile into the hand when the player takes it", () => {
    const plans = planMotion(
      move({ kind: "takePile", count: 2 }),
      me,
      new Map([["top", spot(200, 100, "pile")]]),
      new Map([
        ["top", spot(50, 500)],
        ["under", spot(110, 500)],
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
      none,
      new Map([["theirs", spot(200, 100, "pile")]]),
      anchors,
    );
    expect(discard).toEqual([{ kind: "slide", id: "theirs", from: at(300, 0), reveal: false }]);
    const meld = planMotion(
      move({ kind: "meld", seat: 1 }),
      me,
      none,
      new Map([["laid", spot(320, 40, "seat")]]),
      anchors,
    );
    expect(meld).toEqual([{ kind: "slide", id: "laid", from: at(300, 0), reveal: false }]);
  });

  it("sends a card back to another player's seat for a draw or pickup it cannot show", () => {
    expect(planMotion(move({ kind: "draw", seat: 1 }), me, none, none, anchors)).toEqual([
      { kind: "ghost", from: at(100, 100), to: at(300, 0), cards: 1 },
    ]);
    expect(
      planMotion(move({ kind: "takePile", seat: 1, count: 9 }), me, none, none, anchors),
    ).toEqual([{ kind: "ghost", from: at(200, 100), to: at(300, 0), cards: 3 }]);
  });

  it("leaves alone cards nudged by the layout, and new cards the move does not explain", () => {
    const plans = planMotion(
      move({ kind: "meld" }),
      me,
      new Map([["nudged", spot(50, 500)]]),
      new Map([
        ["nudged", spot(58, 500)],
        ["unexplained", spot(10, 10)],
      ]),
      anchors,
    );
    expect(plans).toEqual([]);
  });

  it("leaves melds where they are when only the layout moved them", () => {
    // The glitch this guards against: a draw grows the hand, the melds shift on
    // screen, and every meld card was flown across the table to where it already was.
    const plans = planMotion(
      move({ kind: "draw", card: { id: "new", rank: "7", suit: "hearts" } }),
      me,
      new Map([["melded", spot(50, 700, "melds")]]),
      new Map([["melded", spot(50, 620, "melds")]]),
      anchors,
    );
    expect(plans).toEqual([]);
  });

  it("flies nothing to or from a place scrolled out of view", () => {
    const hidden = planMotion(
      move({ kind: "meld" }),
      me,
      new Map([
        ["to-hidden", spot(50, 500)],
        ["from-hidden", spot(50, 900, "melds", false)],
      ]),
      new Map([
        ["to-hidden", spot(50, 900, "melds", false)],
        ["from-hidden", spot(110, 500)],
      ]),
      anchors,
    );
    expect(hidden).toEqual([]);
    // Nor a new card that lands out of view.
    expect(
      planMotion(
        move({ kind: "draw", card: { id: "new", rank: "7", suit: "hearts" } }),
        me,
        none,
        new Map([["new", spot(50, 900, "hand", false)]]),
        anchors,
      ),
    ).toEqual([]);
  });

  it("sends no ghost for a seat with no place on the page", () => {
    expect(planMotion(move({ kind: "draw", seat: 4 }), me, none, none, anchors)).toEqual([]);
  });
});
