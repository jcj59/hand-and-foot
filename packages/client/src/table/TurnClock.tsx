/**
 * The turn timer.
 *
 * Reads the absolute deadline through the session's clock offset rather than
 * counting down a number the server sent, which is the whole reason deadlines cross
 * the wire as absolute times — see `serverTime.ts`.
 *
 * It ticks on an interval of its own instead of waiting for the next `ViewUpdate`,
 * because updates only arrive when somebody moves and a clock that froze between
 * moves would be useless. Nothing about the game changes here: the server decides
 * what happens when the time runs out, and this only reports it.
 */
import { useEffect, useState } from "react";
import type { ClockState } from "@hf/shared";
import { useSession } from "../session";
import { formatRemaining, isUrgent } from "./clockText";

/** Four ticks a second: smooth enough to look live, cheap enough to ignore. */
export const TICK_MS = 250;

export interface TurnClockProps {
  readonly clock: ClockState;
  /** Injected in tests; the interval is the only reason this needs a timer at all. */
  readonly tickMs?: number;
}

export function TurnClock({ clock, tickMs = TICK_MS }: TurnClockProps): React.ReactElement {
  const serverClock = useSession((s) => s.clock);
  const [remaining, setRemaining] = useState(() => serverClock.remaining(clock.deadlineAt));

  useEffect(() => {
    // Recomputed immediately as well as on the interval, so a new deadline shows at
    // once rather than after a tick.
    setRemaining(serverClock.remaining(clock.deadlineAt));
    if (clock.deadlineAt === null) return;
    const timer = setInterval(() => setRemaining(serverClock.remaining(clock.deadlineAt)), tickMs);
    return () => clearInterval(timer);
  }, [clock.deadlineAt, serverClock, tickMs]);

  const urgent = isUrgent(remaining);
  const state = clock.paused ? "paused" : clock.inDiscardGrace ? "discard only" : null;

  return (
    <div
      role="timer"
      aria-label={`Time left: ${formatRemaining(remaining)}${state ? `, ${state}` : ""}`}
      className="flex items-baseline gap-2"
    >
      <span className={`font-mono text-2xl tabular-nums ${urgent ? "text-red-300" : "text-white"}`}>
        {formatRemaining(remaining)}
      </span>
      {state && <span className="text-xs text-amber-200">{state}</span>}
    </div>
  );
}
