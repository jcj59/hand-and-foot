import { describe, expect, it } from "vitest";
import { MENU_GAP, MENU_MARGIN, placeMenu, type Box } from "./menuPlacement";

const window = { width: 800, height: 900 };
const menu = { width: 280, height: 250 };
/** A 56 by 86 card (the card and its mark) with its top-left corner at x, y. */
const card = (x: number, y = 700): Box => ({ left: x, top: y, right: x + 56, bottom: y + 86 });

describe("where a card's menu goes", () => {
  it("pins the gap and the margin, which the design's spacing depends on", () => {
    expect([MENU_GAP, MENU_MARGIN]).toEqual([8, 8]);
  });

  it("opens above the card, its left edge on the card's", () => {
    expect(placeMenu(card(200), menu, window)).toEqual({ left: 200, top: 442, side: "above" });
  });

  it("opens from the card's right edge when it would run off the right", () => {
    // 500 + 280 = 780 fits (within 792); 520 + 280 = 800 does not.
    expect(placeMenu(card(512), menu, window).left).toBe(512);
    expect(placeMenu(card(520), menu, window).left).toBe(520 + 56 - 280);
  });

  it("never runs off the left, whatever card it opened from", () => {
    // The card at the start of a wrapped row, and one half off the window.
    expect(placeMenu(card(10), menu, window).left).toBe(10);
    expect(placeMenu(card(-30), menu, window).left).toBe(MENU_MARGIN);
  });

  it("stays a margin inside a window narrower than card and menu together", () => {
    const narrow = { width: 300, height: 900 };
    expect(placeMenu(card(250), menu, narrow).left).toBe(300 - MENU_MARGIN - 280);
    // Wider than the window: its left edge stays on screen.
    expect(placeMenu(card(250), { width: 400, height: 250 }, narrow).left).toBe(MENU_MARGIN);
  });

  it("opens below the card when there is no room above but room below", () => {
    expect(placeMenu(card(200, 100), menu, window)).toEqual({
      left: 200,
      top: 100 + 86 + MENU_GAP,
      side: "below",
    });
  });

  it("opens above exactly when it fits there to the margin", () => {
    // Top at exactly the margin: above.
    expect(placeMenu(card(200, 266), menu, window).side).toBe("above");
    expect(placeMenu(card(200, 266), menu, window).top).toBe(MENU_MARGIN);
    expect(placeMenu(card(200, 265), menu, window).side).toBe("below");
  });

  it("fits nowhere: takes the roomier side and is pulled inside the window", () => {
    const tall = { width: 280, height: 500 };
    const short = { width: 800, height: 600 };
    // More room above (300 - 16 against 600 - 8 - 394): above, pulled down to the margin.
    expect(placeMenu(card(200, 300), tall, short)).toEqual({
      left: 200,
      top: MENU_MARGIN,
      side: "above",
    });
    // More room below: below, pulled up so its bottom keeps the margin.
    expect(placeMenu(card(200, 150), tall, short)).toEqual({
      left: 200,
      top: 600 - MENU_MARGIN - 500,
      side: "below",
    });
  });

  it("takes the side above when the room is even", () => {
    const tall = { width: 280, height: 500 };
    const short = { width: 800, height: 600 };
    // 257 - 16 above, 600 - 8 - (257 + 86 + 8) below: 241 each.
    expect(placeMenu(card(200, 257), tall, short).side).toBe("above");
    expect(placeMenu(card(200, 258), tall, short).side).toBe("above");
    expect(placeMenu(card(200, 256), tall, short).side).toBe("below");
  });

  it("keeps its top on screen when it is taller than the window", () => {
    expect(placeMenu(card(200, 50), { width: 280, height: 2000 }, window).top).toBe(MENU_MARGIN);
  });
});
