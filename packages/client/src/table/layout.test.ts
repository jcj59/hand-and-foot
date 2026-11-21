import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clamp,
  clampLayout,
  DEFAULT_LAYOUT,
  FELT_MIN_WIDTH,
  FOOTER_MIN,
  FOOTER_ROOM,
  LAYOUT_KEY,
  readLayout,
  SEATS_MIN,
  SEATS_ROOM,
  footerRange,
  seatsRange,
  SIDE_MAX,
  SIDE_MIN,
  sideRange,
  writeLayout,
} from "./layout";

afterEach(() => window.localStorage.clear());

const LAPTOP = { width: 1366, height: 768 };
const BIG = { width: 2560, height: 1440 };

describe("the table's sizes", () => {
  it("are the table as it was before anything was dragged", () => {
    // Pinned to literals: the side panel was 260 wide, and the other parts
    // take their natural size until the player sizes them.
    expect(DEFAULT_LAYOUT).toEqual({ sideWidth: 260, footerHeight: null, seatsHeight: null });
    expect(LAYOUT_KEY).toBe("hf.tableLayout");
  });

  it("never squeeze the players' row past the held cards and their count", () => {
    // The height a seat box needs for its face, name, status and row of backs
    // (Seats.tsx); below it the count would be cut.
    expect(SEATS_MIN).toBe(92);
    expect(seatsRange({ width: 1366, height: 300 }).min).toBe(92);
    expect(clamp(10, seatsRange(LAPTOP))).toBe(92);
  });

  it("keep at least one row of cards in the hand", () => {
    expect(FOOTER_MIN).toBe(240);
    expect(clamp(0, footerRange(LAPTOP))).toBe(240);
  });

  it("keep the side panel between its narrowest and widest", () => {
    expect([SIDE_MIN, SIDE_MAX]).toEqual([220, 520]);
    expect(sideRange(BIG)).toEqual({ min: 220, max: 520 });
    expect(clamp(100, sideRange(BIG))).toBe(220);
    expect(clamp(900, sideRange(BIG))).toBe(520);
    expect(clamp(300, sideRange(BIG))).toBe(300);
  });

  it("never let the side panel squeeze the felt below a usable width", () => {
    expect(FELT_MIN_WIDTH).toBe(440);
    // 1000 wide: 1000 less the row's padding and gap (68) less the felt's 440.
    expect(sideRange({ width: 1000, height: 800 })).toEqual({ min: 220, max: 492 });
    expect(clamp(520, sideRange({ width: 1000, height: 800 }))).toBe(492);
  });

  it("keep the default panel on the narrowest computer window", () => {
    // 768 is where the phone layout ends: the panel must not shrink there.
    expect(clamp(260, sideRange({ width: 768, height: 700 }))).toBe(260);
    expect(sideRange({ width: 768, height: 700 }).max).toBe(260);
  });

  it("give a window too small for a part its minimum rather than nothing", () => {
    expect(sideRange({ width: 600, height: 300 })).toEqual({ min: 220, max: 220 });
    expect(footerRange({ width: 600, height: 300 })).toEqual({ min: 240, max: 240 });
    expect(seatsRange({ width: 600, height: 300 })).toEqual({ min: 92, max: 92 });
  });

  it("leave room above the hand and beside the players' row for the rest of the table", () => {
    expect([FOOTER_ROOM, SEATS_ROOM]).toEqual([420, 420]);
    expect(footerRange(LAPTOP)).toEqual({ min: 240, max: 348 });
    expect(seatsRange(LAPTOP)).toEqual({ min: 92, max: 348 });
    expect(clamp(700, footerRange(LAPTOP))).toBe(348);
    expect(clamp(700, seatsRange(LAPTOP))).toBe(348);
  });

  it("are whole pixels", () => {
    expect(clamp(300.6, sideRange(BIG))).toBe(301);
  });

  it("are drawn inside the window, and a natural size stays natural", () => {
    expect(clampLayout({ sideWidth: 900, footerHeight: 900, seatsHeight: 1 }, LAPTOP)).toEqual({
      sideWidth: 520,
      footerHeight: 348,
      seatsHeight: 92,
    });
    expect(clampLayout(DEFAULT_LAYOUT, LAPTOP)).toEqual(DEFAULT_LAYOUT);
    expect(clampLayout({ sideWidth: 300, footerHeight: 300, seatsHeight: 200 }, LAPTOP)).toEqual({
      sideWidth: 300,
      footerHeight: 300,
      seatsHeight: 200,
    });
  });
});

describe("keeping the sizes on this device", () => {
  it("reads back what was written", () => {
    writeLayout({ sideWidth: 400, footerHeight: 300, seatsHeight: 180 });
    expect(JSON.parse(window.localStorage.getItem("hf.tableLayout")!)).toEqual({
      sideWidth: 400,
      footerHeight: 300,
      seatsHeight: 180,
    });
    expect(readLayout()).toEqual({ sideWidth: 400, footerHeight: 300, seatsHeight: 180 });
  });

  it("starts from the default on a device that has kept nothing", () => {
    expect(readLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it("keeps a natural size natural", () => {
    writeLayout({ sideWidth: 300, footerHeight: null, seatsHeight: null });
    expect(readLayout()).toEqual({ sideWidth: 300, footerHeight: null, seatsHeight: null });
  });

  it("takes each unreadable size as its default, keeping the others", () => {
    window.localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ sideWidth: "wide", footerHeight: 310, seatsHeight: -4 }),
    );
    expect(readLayout()).toEqual({ sideWidth: 260, footerHeight: 310, seatsHeight: null });
    window.localStorage.setItem(
      LAYOUT_KEY,
      '{"sideWidth": 300, "footerHeight": 0, "seatsHeight": 1e400}',
    );
    expect(readLayout()).toEqual({ sideWidth: 300, footerHeight: null, seatsHeight: null });
  });

  it("ignores what is not a layout at all", () => {
    for (const raw of ["not json", "null", "7", '"text"']) {
      window.localStorage.setItem(LAYOUT_KEY, raw);
      expect(readLayout()).toEqual(DEFAULT_LAYOUT);
    }
  });

  it("survives a browser that blocks storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(readLayout()).toEqual(DEFAULT_LAYOUT);
      expect(() =>
        writeLayout({ sideWidth: 300, footerHeight: null, seatsHeight: null }),
      ).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
