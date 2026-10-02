import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  EAST_COAST,
  WEST_COAST,
  type Card,
  type GameState,
  type PlayerState,
  type Rank,
} from "@hf/shared";
import { applyAction } from "./reducer";
import { canTakePile } from "./feasibility";
import { defaultAction, heuristicAction } from "./policy";
import { project } from "./view";

/**
 * Random games almost never put a black three on the pile in front of a player
 * holding six more in their foot, so the take-and-settle guarantee in
 * `invariants.property.test.ts` cannot be trusted to have seen one. These build
 * such positions directly: some black threes and wilds in the foot or the hand,
 * a few unrelated singletons, maybe a black-three book already down, and a black
 * three on top of the pile.
 */
const SINGLETONS: readonly Rank[] = ["4", "5", "6", "8", "9", "10", "J", "Q", "K", "A"];

interface Shape {
  readonly threes: number;
  readonly wilds: number;
  readonly singletons: number;
  readonly inFoot: boolean;
  readonly bookDown: boolean;
  readonly isDown: boolean;
  readonly west: boolean;
}

function build(shape: Shape): GameState {
  let id = 0;
  const card = (rank: Rank, suit: Card["suit"] = "spades"): Card => ({
    id: `bt${id++}`,
    rank,
    suit: rank === "JOKER" ? null : suit,
  });
  const zone = [
    ...Array.from({ length: shape.threes }, (_, i) => card("3", i % 2 ? "clubs" : "spades")),
    ...Array.from({ length: shape.wilds }, (_, i) => card(i % 2 ? "2" : "JOKER", "hearts")),
    ...SINGLETONS.slice(0, shape.singletons).map((r) => card(r, "diamonds")),
  ];
  const book = shape.inFoot && shape.bookDown;
  const p: PlayerState = {
    hand: shape.inFoot ? [] : zone,
    foot: shape.inFoot ? zone : [card("7")],
    melds: book
      ? [
          {
            rank: "3",
            cards: Array.from({ length: 7 }, (_, i) => card("3", i % 2 ? "clubs" : "spades")),
          },
        ]
      : [],
    // A player with a book down is down.
    isDown: shape.isDown || book,
    inFoot: shape.inFoot,
    footPending: false,
  };
  const q: PlayerState = {
    hand: [card("7", "hearts")],
    foot: [],
    melds: [],
    isDown: false,
    inFoot: false,
    footPending: false,
  };
  return {
    config: shape.west ? WEST_COAST : EAST_COAST,
    seed: 0,
    roundNumber: 1,
    players: [p, q],
    currentSeat: 0,
    phase: "draw",
    stock: [card("7", "clubs")],
    discard: [card("3", "clubs")],
  };
}

const shapes = fc.record({
  threes: fc.integer({ min: 0, max: 8 }),
  wilds: fc.integer({ min: 0, max: 4 }),
  singletons: fc.integer({ min: 0, max: 4 }),
  inFoot: fc.boolean(),
  bookDown: fc.boolean(),
  isDown: fc.boolean(),
  west: fc.boolean(),
});

describe("taking a pile topped by a black three (property-based)", () => {
  it("is allowed exactly when the three can join a black-three book from the foot", () => {
    fc.assert(
      fc.property(shapes, (shape) => {
        const s = build({ ...shape, isDown: true });
        const threes = shape.threes + 1;
        // Seven cards with at least four threes satisfies either wild ratio.
        const expected =
          shape.inFoot && (shape.bookDown || (threes >= 4 && threes + shape.wilds >= 7));
        expect(canTakePile(s, 0).feasible).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("is always settled by the policy and the heuristic once allowed", () => {
    fc.assert(
      fc.property(shapes, (shape) => {
        const s = build(shape);
        if (!canTakePile(s, 0).feasible) return;
        const took = applyAction(s, { type: "takePile" });
        expect(took.ok).toBe(true);
        if (!took.ok) return;
        for (const settle of [
          defaultAction(took.state),
          heuristicAction(project(took.state, 0), took.state.config),
        ]) {
          expect(settle?.type).toBe("playMelds");
          const settled = applyAction(took.state, settle!);
          expect(settled.ok, settled.ok ? "" : settled.error).toBe(true);
          if (settled.ok) expect(settled.state.players[0].pickedUp).toEqual([]);
        }
      }),
      { numRuns: 500 },
    );
  });
});
