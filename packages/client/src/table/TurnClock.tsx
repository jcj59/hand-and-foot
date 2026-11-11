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
import { Icon } from "../ui/icons";

/** Four ticks a second: smooth enough to look live, cheap enough to ignore. */
export const TICK_MS = 250;

export interface TurnClockProps {
  readonly clock: ClockState;
  /** Injected in tests; the interval is the only reason this needs a timer at all. */
  readonly tickMs?: number;
  /** The phone's smaller pill. */
  readonly compact?: boolean;
}

export function TurnClock({
  clock,
  tickMs = TICK_MS,
  compact = false,
}: TurnClockProps): React.ReactElement {
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
  const look = clock.paused
    ? "bg-blue/16 text-blue"
    : clock.inDiscardGrace
      ? "bg-danger/20 text-danger-soft"
      : urgent
        ? "bg-gold/18 text-gold"
        : "bg-white/8 text-ink";

  return (
    <div
      role="timer"
      aria-label={`Time left: ${formatRemaining(remaining)}${state ? `, ${state}` : ""}`}
      className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full px-2.5 font-mono text-[13px] font-bold tabular-nums ${look} ${compact ? "" : "md:text-sm"}`}
    >
      <Icon name="clock" size={14} />
      {formatRemaining(remaining)}
      {/* Melding is closed but the player still chooses their own card; said in
          the pill so a refused meld is never unexplained. */}
      {clock.inDiscardGrace && !clock.paused && (
        <span className="font-sans text-[11px] font-semibold">discard only</span>
      )}
    </div>
  );
}

/** The same deadline as words in a line, for the player on turn: "0:41". */
export function useRemaining(clock: ClockState, tickMs = TICK_MS): string {
  const serverClock = useSession((s) => s.clock);
  const [remaining, setRemaining] = useState(() => serverClock.remaining(clock.deadlineAt));
  useEffect(() => {
    setRemaining(serverClock.remaining(clock.deadlineAt));
    if (clock.deadlineAt === null) return;
    const timer = setInterval(() => setRemaining(serverClock.remaining(clock.deadlineAt)), tickMs);
    return () => clearInterval(timer);
  }, [clock.deadlineAt, serverClock, tickMs]);
  return formatRemaining(remaining);
}
