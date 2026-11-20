import { describe, it, expect } from "vitest";
import { ARROW_STEP, ARROW_STEP_FAST, EDGE_MARGIN, arrowOffset, clampOffset } from "./drag";

const view = { width: 1000, height: 800 };
const box = { left: 100, top: 300, right: 900, bottom: 800 };

describe("keeping the scoreboard inside the window", () => {
  it("pins the constants a player feels", () => {
    expect(EDGE_MARGIN).toBe(8);
    expect(ARROW_STEP).toBe(24);
    expect(ARROW_STEP_FAST).toBe(96);
  });

  it("lets it move freely inside, and stops it a margin from each edge", () => {
    expect(clampOffset({ x: -40, y: -60 }, { x: 0, y: 0 }, box, view)).toEqual({ x: -40, y: -60 });
    expect(clampOffset({ x: -500, y: -900 }, { x: 0, y: 0 }, box, view)).toEqual({
      x: -92,
      y: -292,
    });
    expect(clampOffset({ x: 500, y: 0 }, { x: 0, y: 0 }, box, view)).toEqual({ x: 92, y: 0 });
  });

  it("does not push a board already within the margin of an edge", () => {
    const high = { left: 4, top: 4, right: 900, bottom: 700 };
    expect(clampOffset({ x: 0, y: 0 }, { x: 0, y: 0 }, high, view)).toEqual({ x: 0, y: 0 });
  });

  it("measures from where the board is now, not where it opened", () => {
    const moved = { left: 150, top: 250, right: 950, bottom: 750 };
    expect(clampOffset({ x: 500, y: 500 }, { x: 50, y: -50 }, moved, view)).toEqual({
      x: 92,
      y: 0,
    });
  });

  it("never pushes a board bigger than the window further out", () => {
    const big = { left: -10, top: 0, right: 1010, bottom: 800 };
    expect(clampOffset({ x: 30, y: 30 }, { x: 0, y: 0 }, big, view)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -30, y: -30 }, { x: 0, y: 0 }, big, view)).toEqual({ x: 0, y: 0 });
  });
});

describe("the arrow keys", () => {
  const at = { x: 10, y: 20 };
  it("move a step, or a long one with Shift", () => {
    expect(arrowOffset("ArrowLeft", false, at)).toEqual({ x: -14, y: 20 });
    expect(arrowOffset("ArrowRight", false, at)).toEqual({ x: 34, y: 20 });
    expect(arrowOffset("ArrowUp", false, at)).toEqual({ x: 10, y: -4 });
    expect(arrowOffset("ArrowDown", true, at)).toEqual({ x: 10, y: 116 });
    expect(arrowOffset("Tab", false, at)).toBeNull();
  });
});
