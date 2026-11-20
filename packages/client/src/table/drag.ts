/**
 * Moving the scoreboard aside on a computer, to look at the table behind it.
 *
 * The board is a dialog over the table, and at the end of a round the table is
 * what people want to look at next: whose melds were where, what was on the pile.
 * "Look at the table" hides the board entirely; dragging it by its heading keeps
 * the scores in view beside the cards they came from. The position is not kept:
 * each result opens where it always does.
 *
 * `clampOffset` is the pure part: wherever the pointer goes, the board stays
 * inside the window, so its heading (the only way to move it back) cannot be
 * dragged out of reach.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface Offset {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const ORIGIN: Offset = { x: 0, y: 0 };

/** How far the board keeps from the window's edges when dragged to one. */
export const EDGE_MARGIN = 8;
/** How far one arrow key moves the board, and with Shift held. */
export const ARROW_STEP = 24;
export const ARROW_STEP_FAST = 96;

/**
 * The offset nearest `want` that keeps the board inside the window, given where
 * it is now (`box`, measured at the offset `at`). A board too big for the window
 * on an axis, or already past an edge, is never pushed further out on it: the
 * bounds always include where layout put it (offset 0).
 */
export function clampOffset(
  want: Offset,
  at: Offset,
  box: Box,
  view: { readonly width: number; readonly height: number },
): Offset {
  const axis = (v: number, start: number, end: number, size: number): number => {
    const lo = Math.min(0, EDGE_MARGIN - start);
    const hi = Math.max(0, size - EDGE_MARGIN - end);
    return Math.min(hi, Math.max(lo, v));
  };
  return {
    x: axis(want.x, box.left - at.x, box.right - at.x, view.width),
    y: axis(want.y, box.top - at.y, box.bottom - at.y, view.height),
  };
}

/** The offset an arrow key asks for, or null for any other key. */
export function arrowOffset(key: string, shift: boolean, at: Offset): Offset | null {
  const step = shift ? ARROW_STEP_FAST : ARROW_STEP;
  switch (key) {
    case "ArrowLeft":
      return { x: at.x - step, y: at.y };
    case "ArrowRight":
      return { x: at.x + step, y: at.y };
    case "ArrowUp":
      return { x: at.x, y: at.y - step };
    case "ArrowDown":
      return { x: at.x, y: at.y + step };
    default:
      return null;
  }
}

export interface Draggable<T extends HTMLElement> {
  /** The element that moves. */
  readonly ref: React.RefObject<T | null>;
  readonly offset: Offset;
  /** Whether it is anywhere but where it opened. */
  readonly moved: boolean;
  /** Spread on the heading the board is dragged by. */
  readonly handle: {
    readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  };
  /** For the focusable grip: the arrow keys move the board. */
  readonly onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * Drag an element by a handle, clamped to the window. Changing `resetKey` puts it
 * back where it opened; so does `enabled` going false (a phone keeps its sheet).
 */
export function useDraggable<T extends HTMLElement>(
  enabled: boolean,
  resetKey: unknown,
): Draggable<T> {
  const ref = useRef<T | null>(null);
  const [offset, setOffset] = useState<Offset>(ORIGIN);
  const offsetRef = useRef<Offset>(ORIGIN);
  const grab = useRef<{ readonly id: number; readonly x: number; readonly y: number } | null>(null);

  const place = useCallback((want: Offset) => {
    const el = ref.current;
    if (!el) return;
    const next = clampOffset(want, offsetRef.current, el.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    offsetRef.current = next;
    setOffset(next);
  }, []);

  useEffect(() => {
    offsetRef.current = ORIGIN;
    setOffset(ORIGIN);
    grab.current = null;
  }, [resetKey, enabled]);

  // A smaller window must not leave the board outside it.
  useEffect(() => {
    if (!enabled) return;
    const refit = (): void => place(offsetRef.current);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [enabled, place]);

  const release = (e: React.PointerEvent<HTMLElement>): void => {
    if (grab.current?.id !== e.pointerId) return;
    grab.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return {
    ref,
    offset,
    moved: offset.x !== 0 || offset.y !== 0,
    handle: {
      onPointerDown: (e) => {
        // The main button only, and never a press meant for a control in the heading.
        if (!enabled || e.button !== 0) return;
        if (e.target instanceof Element && e.target.closest("button") !== null) return;
        e.preventDefault();
        grab.current = {
          id: e.pointerId,
          x: e.clientX - offsetRef.current.x,
          y: e.clientY - offsetRef.current.y,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
      onPointerMove: (e) => {
        const g = grab.current;
        if (!g || g.id !== e.pointerId) return;
        place({ x: e.clientX - g.x, y: e.clientY - g.y });
      },
      onPointerUp: release,
      onPointerCancel: release,
    },
    onKeyDown: (e) => {
      if (!enabled) return;
      const want = arrowOffset(e.key, e.shiftKey, offsetRef.current);
      if (!want) return;
      e.preventDefault();
      place(want);
    },
  };
}
