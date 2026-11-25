/**
 * "Report a bug", always in the bottom-right corner, on every screen, so a player
 * can report a problem wherever they meet it without first finding a menu.
 *
 * Small and quiet, so it sits over the page without competing with it. A bar that
 * owns the bottom edge of the screen (the phone's tab bar, a replay's playback
 * bar, a round's result along the bottom) lifts it clear by its own height (`useReportLift`). At a table it attaches
 * the table's details, as the table menu's report does (see `reportSource.ts`).
 */
import { useLayoutEffect, useState } from "react";
import type { TableReport } from "./context";
import { ReportSheet } from "./ReportSheet";
import { currentTableReport } from "./reportSource";
import { Icon } from "../ui/icons";

/** How far a bar along the bottom of the screen lifts the button, while it is shown. */
export const REPORT_LIFT_VAR = "--report-lift";

/** The lift each mounted bar asks for, by bar; the button clears the highest. */
const lifts = new Map<symbol, number>();

function applyLift(): void {
  const root = document.documentElement.style;
  if (lifts.size === 0) root.removeProperty(REPORT_LIFT_VAR);
  else root.setProperty(REPORT_LIFT_VAR, `${Math.max(...lifts.values())}px`);
}

/** How far `bar` reaches up from the bottom of the window: its height and any gap below it. */
function liftOf(bar: HTMLElement): number {
  const rect = bar.getBoundingClientRect();
  const gap = rect.height > 0 ? Math.max(0, window.innerHeight - rect.bottom) : 0;
  return bar.offsetHeight + gap;
}

/**
 * Lift the corner button above the element given to the returned ref, while it is
 * mounted, following its size. With several such bars on screen, the button clears
 * the one that reaches highest.
 */
export function useReportLift<T extends HTMLElement>(): (bar: T | null) => void {
  const [bar, setBar] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!bar) return;
    const key = Symbol("lift");
    const measure = (): void => {
      lifts.set(key, liftOf(bar));
      applyLift();
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (observer) observer.observe(bar);
    else window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      lifts.delete(key);
      applyLift();
    };
  }, [bar]);
  return setBar;
}

export function ReportButton(): React.ReactElement {
  // Open with the table's details as they were when the button was pressed, or
  // with none away from a table.
  const [open, setOpen] = useState<{ readonly table: TableReport | null } | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Report a bug"
        title="Report a bug"
        onClick={() => setOpen({ table: currentTableReport() })}
        className="fixed z-40 flex size-9 items-center justify-center rounded-full border border-white/15 bg-nav/85 text-ink-soft shadow-lg backdrop-blur-sm transition-colors hover:bg-nav hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        style={{
          right: "max(12px, calc(env(safe-area-inset-right, 0px) + 8px))",
          bottom: `calc(max(var(${REPORT_LIFT_VAR}, 0px), env(safe-area-inset-bottom, 0px)) + 12px)`,
        }}
      >
        <Icon name="bug" size={18} />
      </button>
      {open && <ReportSheet table={open.table} onClose={() => setOpen(null)} />}
    </>
  );
}
