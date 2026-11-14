/**
 * Where a card's menu goes on a computer: above the card, its left edge on the
 * card's, as the design draws it; from the card's right edge instead when that
 * would run off the right of the window; below the card when there is no room
 * above; and always pulled back inside the window, a margin from every edge.
 *
 * Pure, and in the window's own coordinates (`getBoundingClientRect`), so the
 * menu can be drawn `position: fixed` outside every box that might clip it.
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface MenuPlace {
  readonly left: number;
  readonly top: number;
  /** Which side of the card the menu opened on. */
  readonly side: "above" | "below";
}

/** The space between the card and its menu. */
export const MENU_GAP = 8;
/** The least space between the menu and the window's edge. */
export const MENU_MARGIN = 8;

export function placeMenu(card: Box, menu: Size, window: Size): MenuPlace {
  const fitsFrom = (left: number) => left + menu.width <= window.width - MENU_MARGIN;
  const preferred = fitsFrom(card.left) ? card.left : card.right - menu.width;
  const left = clamp(preferred, MENU_MARGIN, window.width - MENU_MARGIN - menu.width);

  const above = card.top - MENU_GAP - menu.height;
  const below = card.bottom + MENU_GAP;
  const roomAbove = card.top - MENU_GAP - MENU_MARGIN;
  const roomBelow = window.height - MENU_MARGIN - below;
  // Above by default (the hand is at the bottom of the window); below only when
  // it does not fit above and there is more room below. A menu that fits below
  // but not above always has more room below, so that case needs no test of its own.
  const side = above >= MENU_MARGIN || roomAbove >= roomBelow ? "above" : "below";
  const top = clamp(
    side === "above" ? above : below,
    MENU_MARGIN,
    window.height - MENU_MARGIN - menu.height,
  );
  return { left, top, side };
}

/**
 * `value` held between `low` and `high`; when the range is empty (a menu wider
 * or taller than the window) the low end wins, so the menu's start (its title,
 * its left edge) stays on screen.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}
