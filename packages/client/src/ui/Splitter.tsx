/**
 * A divider between two parts of the screen that the player drags to resize one
 * of them, or moves with the arrow keys once it has focus. Home or a double-click
 * puts the part back to its default size.
 *
 * It is the ARIA window splitter: `role="separator"`, focusable, with the size of
 * the part it resizes as its value. `orientation` is the line's own: a vertical
 * line resizes a width, a horizontal one a height.
 *
 * The pointer is captured for the whole drag, so a fast drag that leaves the thin
 * handle (or the window) keeps resizing until the button comes up. While a drag is
 * on, `body[data-resizing]` turns off the page's transitions and text selection
 * and keeps the resize cursor everywhere (see `index.css`).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { clamp as fit, type Range } from "../table/layout";

export interface SplitterProps {
  readonly orientation: "vertical" | "horizontal";
  /** The accessible name: what the divider resizes ("Resize your hand"). */
  readonly label: string;
  /** The id of the part it resizes. */
  readonly controls: string;
  /** The part's size as chosen, or `null` while it has its natural size. */
  readonly value: number | null;
  readonly range: Range;
  /**
   * Which way the part grows as the line moves right (vertical) or down
   * (horizontal): `1` for a part before the line, `-1` for one after it.
   */
  readonly grows: 1 | -1;
  /** The part's size as drawn right now, for a part still at its natural size. */
  readonly measure: () => number;
  /** A new size, already inside `range`, during a drag or on a key. */
  readonly onResize: (size: number) => void;
  /** A drag or a key press is over: the size can be kept. */
  readonly onDone: () => void;
  readonly onReset: () => void;
  readonly className?: string;
}

/** How far one arrow press moves the line, and with Shift. */
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

export function Splitter({
  orientation,
  label,
  controls,
  value,
  range,
  grows,
  measure,
  onResize,
  onDone,
  onReset,
  className = "",
}: SplitterProps): React.ReactElement {
  const drag = useRef<{
    readonly pointer: number;
    readonly from: number;
    readonly size: number;
  } | null>(null);
  const vertical = orientation === "vertical";
  // A part at its natural size still has a size to announce: read it once drawn.
  const [natural, setNatural] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (value !== null) return;
    const size = Math.round(measure());
    if (size !== natural) setNatural(size);
  });
  const current = (): number => fit(value ?? measure(), range);

  const position = (e: React.PointerEvent): number => (vertical ? e.clientX : e.clientY);
  const end = (e: React.PointerEvent): void => {
    // Only the pointer that grabbed the divider lets go of it.
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    delete document.body.dataset.resizing;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    onDone();
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={orientation}
      aria-valuenow={fit(value ?? natural ?? range.min, range)}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      title={`${label}. Double-click to reset.`}
      data-splitter={orientation}
      className={`group relative z-10 flex shrink-0 touch-none items-center justify-center outline-none select-none ${
        vertical ? "cursor-col-resize" : "cursor-row-resize"
      } ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { pointer: e.pointerId, from: position(e), size: current() };
        document.body.dataset.resizing = orientation;
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (start?.pointer !== e.pointerId) return;
        onResize(fit(start.size + grows * (position(e) - start.from), range));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "Home") {
          e.preventDefault();
          onReset();
          return;
        }
        const toward = keyDirection(e.key, vertical);
        if (toward === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
        onResize(fit(current() + grows * toward * step, range));
        onDone();
      }}
    >
      {/* The grip: faint until the divider is pointed at, grabbed or focused. */}
      <span
        aria-hidden="true"
        className={`rounded-full bg-white/14 transition-colors group-hover:bg-accent/80 group-focus-visible:bg-accent group-active:bg-accent ${
          vertical ? "h-10 w-1" : "h-1 w-10"
        }`}
      />
    </div>
  );
}

/** Which way a key moves the line: `1` right or down, `-1` left or up, `0` not an arrow for it. */
function keyDirection(key: string, vertical: boolean): -1 | 0 | 1 {
  if (vertical) return key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
}
