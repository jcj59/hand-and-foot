import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Card } from "@hf/shared";
import {
  dropAt,
  handOrderKey,
  readHandOrder,
  useHandOrder,
  writeHandOrder,
  type HandOrderScope,
  type Slot,
} from "./handArrangement";
import { DRAG_START_PX } from "./Hand";

const scope: HandOrderScope = { roomId: "ABC234", seat: 2, round: 1, zone: "hand" };
const card = (id: string, rank: Card["rank"] = "K"): Card => ({ id, rank, suit: "clubs" });

beforeEach(() => window.sessionStorage.clear());

describe("keeping an arrangement", () => {
  it("is kept per table and seat under hf.handOrder", () => {
    expect(handOrderKey(scope)).toBe("hf.handOrder:ABC234:2");
  });

  it("reads back what was written for the same round and zone", () => {
    writeHandOrder(scope, ["a", "b"]);
    expect(JSON.parse(window.sessionStorage.getItem("hf.handOrder:ABC234:2")!)).toEqual({
      round: 1,
      zone: "hand",
      ids: ["a", "b"],
    });
    expect(readHandOrder(scope)).toEqual(["a", "b"]);
  });

  it("is none in another round, in the foot, or at another seat or table", () => {
    writeHandOrder(scope, ["a", "b"]);
    expect(readHandOrder({ ...scope, round: 2 })).toBeNull();
    expect(readHandOrder({ ...scope, zone: "foot" })).toBeNull();
    expect(readHandOrder({ ...scope, seat: 1 })).toBeNull();
    expect(readHandOrder({ ...scope, roomId: "XYZ789" })).toBeNull();
  });

  it("forgets it for null", () => {
    writeHandOrder(scope, ["a"]);
    writeHandOrder(scope, null);
    expect(window.sessionStorage.getItem(handOrderKey(scope))).toBeNull();
    expect(readHandOrder(scope)).toBeNull();
  });

  it("treats anything unreadable as none", () => {
    const key = handOrderKey(scope);
    for (const raw of [
      "not json",
      JSON.stringify({ round: 1, zone: "hand" }),
      JSON.stringify({ round: 1, zone: "hand", ids: "a" }),
      JSON.stringify({ round: 1, zone: "hand", ids: ["a", 3] }),
      JSON.stringify({ round: "1", zone: "hand", ids: ["a"] }),
    ]) {
      window.sessionStorage.setItem(key, raw);
      expect(readHandOrder(scope)).toBeNull();
    }
  });

  describe("with storage blocked", () => {
    const real = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
    beforeEach(() => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new Error("blocked");
        },
      });
    });
    afterEach(() => Object.defineProperty(window, "sessionStorage", real));

    it("reads none and writes nothing, without throwing", () => {
      expect(() => writeHandOrder(scope, ["a"])).not.toThrow();
      expect(() => writeHandOrder(scope, null)).not.toThrow();
      expect(readHandOrder(scope)).toBeNull();
    });

    it("still keeps the arrangement for as long as the page", () => {
      const cards = [card("a"), card("b")];
      const { result } = renderHook(() => useHandOrder(scope, cards));
      act(() => result.current[1](["b", "a"]));
      expect(result.current[0]).toEqual(["b", "a"]);
    });
  });
});

describe("useHandOrder", () => {
  it("starts from what the tab kept", () => {
    writeHandOrder(scope, ["b", "a"]);
    const cards = [card("a"), card("b")];
    const { result } = renderHook(() => useHandOrder(scope, cards));
    expect(result.current[0]).toEqual(["b", "a"]);
  });

  it("has none, and keeps none, for a hand that is not the viewer's", () => {
    writeHandOrder(scope, ["b", "a"]);
    const { result } = renderHook(() => useHandOrder(null, [card("a")]));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1](["a"]));
    expect(result.current[0]).toBeNull();
    expect(readHandOrder(scope)).toEqual(["b", "a"]);
  });

  it("writes a change through, and null puts the usual order back", () => {
    const cards = [card("a"), card("b")];
    const { result } = renderHook(() => useHandOrder(scope, cards));
    act(() => result.current[1](["b", "a"]));
    expect(result.current[0]).toEqual(["b", "a"]);
    expect(readHandOrder(scope)).toEqual(["b", "a"]);
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(readHandOrder(scope)).toBeNull();
  });

  it("keeps cards that arrive in the order they arrived, newest at the right", () => {
    // Without writing each arrival through, the next card would be sorted in among
    // the last one, rather than going to its right where "NEW" points.
    const a = card("a", "4");
    const b = card("b", "9");
    const { result, rerender } = renderHook(({ cards }) => useHandOrder(scope, cards), {
      initialProps: { cards: [a, b] },
    });
    act(() => result.current[1](["b", "a"]));
    const king = card("king", "K");
    rerender({ cards: [a, b, king] });
    expect(result.current[0]).toEqual(["b", "a", "king"]);
    const five = card("five", "5");
    rerender({ cards: [a, b, king, five] });
    expect(result.current[0]).toEqual(["b", "a", "king", "five"]);
    // Played cards drop out of what is kept, too.
    rerender({ cards: [b, five] });
    expect(result.current[0]).toEqual(["b", "five"]);
    expect(readHandOrder(scope)).toEqual(["b", "five"]);
  });

  it("writes the order back when the last card goes, or one goes as another comes", () => {
    const [a, b, c, d] = [card("a", "4"), card("b", "9"), card("c", "K"), card("d", "5")];
    const { result, rerender } = renderHook(({ cards }) => useHandOrder(scope, cards), {
      initialProps: { cards: [a, b, c] },
    });
    act(() => result.current[1](["c", "b", "a"]));
    // The last card played: the rest are shown as they were, one fewer.
    rerender({ cards: [b, c] });
    expect(result.current[0]).toEqual(["c", "b"]);
    // One played and one drawn in the same update: as many cards, not the same ones.
    rerender({ cards: [c, d] });
    expect(result.current[0]).toEqual(["c", "d"]);
    expect(readHandOrder(scope)).toEqual(["c", "d"]);
  });

  it("starts again in a new round and in the foot", () => {
    const cards = [card("a"), card("b")];
    const { result, rerender } = renderHook(({ at }) => useHandOrder(at, cards), {
      initialProps: { at: scope },
    });
    act(() => result.current[1](["b", "a"]));
    rerender({ at: { ...scope, zone: "foot" } });
    expect(result.current[0]).toBeNull();
    rerender({ at: { ...scope, round: 2 } });
    expect(result.current[0]).toBeNull();
    // Back to the scope it was made for (a reload mid-round reads it the same way).
    rerender({ at: scope });
    expect(result.current[0]).toEqual(["b", "a"]);
  });
});

describe("dropAt", () => {
  // Two rows of three 46px cards with 4px gaps, 66px tall, 6px apart: a phone's hand.
  const phone: Slot[] = [0, 1, 2, 3, 4, 5].map((i) => ({
    x: (i % 3) * 50,
    y: Math.floor(i / 3) * 72,
    w: 46,
    h: 66,
  }));

  it("lands before the first card whose middle is right of the pointer", () => {
    expect(dropAt(phone, { x: 10, y: 30 })).toEqual({ index: 0, x: 0, y: 0, h: 66 });
    expect(dropAt(phone, { x: 30, y: 30 })).toEqual({ index: 1, x: 50, y: 0, h: 66 });
    expect(dropAt(phone, { x: 72, y: 30 })!.index).toBe(1);
    expect(dropAt(phone, { x: 74, y: 30 })!.index).toBe(2);
  });

  it("lands after a row's last card past its middle", () => {
    expect(dropAt(phone, { x: 140, y: 30 })).toEqual({ index: 3, x: 146, y: 0, h: 66 });
    expect(dropAt(phone, { x: 400, y: 100 })).toEqual({ index: 6, x: 146, y: 72, h: 66 });
  });

  it("goes to the row under the pointer, across rows", () => {
    expect(dropAt(phone, { x: 10, y: 100 })).toEqual({ index: 3, x: 0, y: 72, h: 66 });
    expect(dropAt(phone, { x: 60, y: 72 })!.index).toBe(4);
    expect(dropAt(phone, { x: 60, y: 66 })!.index).toBe(1);
  });

  it("goes to the nearest row when above, between or below them all", () => {
    expect(dropAt(phone, { x: 60, y: -40 })!.index).toBe(1);
    expect(dropAt(phone, { x: 60, y: 68 })!.index).toBe(1);
    expect(dropAt(phone, { x: 60, y: 71 })!.index).toBe(4);
    expect(dropAt(phone, { x: 60, y: 500 })!.index).toBe(4);
  });

  it("reads overlapping cards in one row as one row", () => {
    // A computer's hand: 56px cards overlapping by 12px, one lifted 14px.
    const row: Slot[] = [0, 1, 2].map((i) => ({ x: i * 44, y: i === 1 ? -14 : 0, w: 56, h: 80 }));
    expect(dropAt(row, { x: 60, y: 40 })).toEqual({ index: 1, x: 44, y: 0, h: 80 });
    expect(dropAt(row, { x: 200, y: 40 })!.index).toBe(3);
  });

  it("takes the upper row when the pointer is exactly between two", () => {
    expect(dropAt(phone, { x: 60, y: 69 })!.index).toBe(1);
  });

  it("starts a new row at a card more than half a card lower than the one before", () => {
    const stepped: Slot[] = [
      { x: 0, y: 0, w: 56, h: 80 },
      { x: 60, y: 41, w: 56, h: 80 },
    ];
    expect(dropAt(stepped, { x: 100, y: 10 })).toEqual({ index: 1, x: 56, y: 0, h: 80 });
  });

  it("is nowhere for no cards", () => {
    expect(dropAt([], { x: 0, y: 0 })).toBeNull();
  });
});

describe("the drag threshold", () => {
  it("is 6 pixels, so a click that shook still opens the card's menu", () => {
    expect(DRAG_START_PX).toBe(6);
  });
});
