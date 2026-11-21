/**
 * The computer table's layout as React state: the sizes this device keeps
 * (`layout.ts`), clamped to the window as it is resized, and what each divider
 * needs to move one of them. A size is kept on the device when a drag or key
 * press ends, not on every pointer move.
 */
import { useEffect, useRef, useState } from "react";
import {
  clampLayout,
  DEFAULT_LAYOUT,
  footerRange,
  readLayout,
  seatsRange,
  sideRange,
  writeLayout,
  type Range,
  type TableLayout,
} from "./layout";
import type { Size } from "./menuPlacement";

/** What a `Splitter` takes for one part, less its look and how to measure it. */
export interface PartSizing {
  readonly value: number | null;
  readonly range: Range;
  readonly onResize: (size: number) => void;
  readonly onDone: () => void;
  readonly onReset: () => void;
}

export interface TableLayoutState {
  /** The sizes to draw, inside this window's ranges. */
  readonly drawn: TableLayout;
  readonly side: PartSizing;
  readonly footer: PartSizing;
  readonly seats: PartSizing;
}

export function useTableLayout(): TableLayoutState {
  const [layout, setLayout] = useState(readLayout);
  // The newest sizes, for keeping them right after a key press set them, before
  // React has drawn them.
  const latest = useRef(layout);
  const screen = useWindowSize();

  const part = (field: keyof TableLayout, range: Range): PartSizing => {
    const set = (value: number | null): void => {
      latest.current = { ...latest.current, [field]: value };
      setLayout(latest.current);
    };
    return {
      value: clampLayout(layout, screen)[field],
      range,
      onResize: set,
      onDone: () => writeLayout(latest.current),
      onReset: () => {
        set(DEFAULT_LAYOUT[field]);
        writeLayout(latest.current);
      },
    };
  };

  return {
    drawn: clampLayout(layout, screen),
    side: part("sideWidth", sideRange(screen)),
    footer: part("footerHeight", footerRange(screen)),
    seats: part("seatsHeight", seatsRange(screen)),
  };
}

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function useWindowSize(): Size {
  const [size, setSize] = useState(windowSize);
  useEffect(() => {
    const onResize = (): void =>
      setSize((was) => {
        const now = windowSize();
        return now.width === was.width && now.height === was.height ? was : now;
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}
