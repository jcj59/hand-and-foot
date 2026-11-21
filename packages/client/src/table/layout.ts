/**
 * How a computer's table is divided, as the player has dragged it: the side
 * panel's width, the hand's height along the bottom, and the height of the other
 * players' row across the top of the felt. Kept per device under `hf.tableLayout`.
 *
 * A height of `null` is the part's natural size, which is how the table is laid
 * out until the player drags it: the hand as tall as its rows, the players as tall
 * as their boxes. So the default table is the one there was before any of this,
 * and resetting a divider puts that back rather than some guessed number.
 *
 * What is stored is what the player chose; what is drawn is that choice clamped
 * to the window as it is now (`clampLayout`), so a window made smaller squeezes
 * the parts and a window made larger again gives the player's sizes back.
 *
 * Pure apart from `readLayout`/`writeLayout`, which only touch `localStorage`
 * and survive it being blocked.
 */
import type { Size } from "./menuPlacement";

export interface TableLayout {
  /** The side panel's width, in pixels, while it is shown. */
  readonly sideWidth: number;
  /** The footer's height (the hand and the buttons above it), or `null` for its natural size. */
  readonly footerHeight: number | null;
  /** The other players' row's height on the felt, or `null` for its natural size. */
  readonly seatsHeight: number | null;
}

export const DEFAULT_LAYOUT: TableLayout = {
  sideWidth: 260,
  footerHeight: null,
  seatsHeight: null,
};

export const LAYOUT_KEY = "hf.tableLayout";

/** Narrower and the scores' columns crowd each other. */
export const SIDE_MIN = 220;
/** Wider and it is no longer a side panel. */
export const SIDE_MAX = 520;
/**
 * The felt is never squeezed below this by the side panel: room for the piles and
 * two players' boxes side by side. Small enough that the default panel fits beside
 * it on the narrowest computer window (768 wide), so the default never moves.
 */
export const FELT_MIN_WIDTH = 440;
/** What the table row spends across besides the felt and the panel: its padding and the gap. */
const ROW_CHROME_WIDTH = 48 + 20;

/** The buttons, the hand's title and one row of cards, with the footer's padding. */
export const FOOTER_MIN = 240;
/**
 * What the window keeps above the footer however tall the player makes it: the
 * header, and enough felt for the other players' row and the piles.
 */
export const FOOTER_ROOM = 420;

/**
 * Never shorter than one seat box's header (face, name, status, the held cards
 * and the foot): the row of backs and the count are never cut, however the
 * player drags it. Only the melds give way, scrolling inside each box.
 */
export const SEATS_MIN = 92;
/** What the window keeps beside the players' row: header, piles, the hand at its smallest. */
export const SEATS_ROOM = 420;

/** The range a divider can move in, for this window. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

export function sideRange(window: Size): Range {
  return range(SIDE_MIN, Math.min(SIDE_MAX, window.width - ROW_CHROME_WIDTH - FELT_MIN_WIDTH));
}

export function footerRange(window: Size): Range {
  return range(FOOTER_MIN, window.height - FOOTER_ROOM);
}

export function seatsRange(window: Size): Range {
  return range(SEATS_MIN, window.height - SEATS_ROOM);
}

/** The layout to draw in this window: each size inside its range, a natural size left natural. */
export function clampLayout(layout: TableLayout, window: Size): TableLayout {
  return {
    sideWidth: clamp(layout.sideWidth, sideRange(window)),
    footerHeight:
      layout.footerHeight === null ? null : clamp(layout.footerHeight, footerRange(window)),
    seatsHeight: layout.seatsHeight === null ? null : clamp(layout.seatsHeight, seatsRange(window)),
  };
}

export function clamp(value: number, { min, max }: Range): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** A window too small for the part's minimum still gets the minimum: the felt scrolls instead. */
function range(min: number, max: number): Range {
  return { min, max: Math.max(min, max) };
}

/** The layout this device keeps, a field at a time: anything unreadable is its default. */
export function readLayout(): TableLayout {
  let stored: unknown;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    stored = raw === null ? null : JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (typeof stored !== "object" || stored === null) return DEFAULT_LAYOUT;
  const { sideWidth, footerHeight, seatsHeight } = stored as Record<string, unknown>;
  return {
    sideWidth: isSize(sideWidth) ? sideWidth : DEFAULT_LAYOUT.sideWidth,
    footerHeight: isSize(footerHeight) ? footerHeight : DEFAULT_LAYOUT.footerHeight,
    seatsHeight: isSize(seatsHeight) ? seatsHeight : DEFAULT_LAYOUT.seatsHeight,
  };
}

export function writeLayout(layout: TableLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Blocked storage: the sizes last until the page is reloaded.
  }
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
