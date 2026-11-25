/**
 * Where a report gets the table's details from, when there is a table on screen.
 *
 * The "Report a bug" button sits in the corner of every screen, outside any
 * table, so the table registers how to read its details while it is mounted and
 * the button asks as its sheet opens. One table is on screen at a time; the last
 * to register wins, and unmounting clears only its own registration.
 */
import { useEffect, useRef } from "react";
import type { TableReport } from "./context";

type Source = () => TableReport;

let current: { readonly read: Source } | null = null;

/** The table's details now, or null when no table is on screen. */
export function currentTableReport(): TableReport | null {
  return current ? current.read() : null;
}

/** Offer this table's details to a report for as long as the caller is mounted. */
export function useTableReportSource(read: Source): void {
  // The newest `read` is used, without re-registering on every render.
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    const mine = { read: () => latest.current() };
    current = mine;
    return () => {
      if (current === mine) current = null;
    };
  }, []);
}
