/**
 * What a paused table is waiting for: who paused it, or that it paused itself,
 * and when it will be closed if nobody resumes it — with the way to resume, and
 * for a family game the way to keep it for another day.
 *
 * The closing time is shown as a clock time rather than a countdown. It is half
 * an hour or a week away, and a countdown would tick for no reason.
 */
import type { RoomInfo } from "@hf/shared";

export interface PauseBarProps {
  readonly room: RoomInfo;
  readonly nameOf: (seat: number) => string;
  readonly busy: boolean;
  readonly onResume: () => void;
  readonly onSaveForLater: () => void;
}

export function PauseBar({
  room,
  nameOf,
  busy,
  onResume,
  onSaveForLater,
}: PauseBarProps): React.ReactElement | null {
  const paused = room.pausedBy !== undefined || room.idlePaused === true;
  if (!paused) return null;

  const who = room.idlePaused
    ? "Paused because nobody has played for a full lap."
    : `${nameOf(room.pausedBy!)} paused the table.`;
  const saved = room.savedUntil ?? null;
  const closes = room.closesAt ?? null;
  const when =
    saved !== null
      ? `Saved for later until ${formatDay(saved)}. Come back through the home screen or this table's link to pick the game back up.`
      : closes !== null
        ? `It closes at ${formatTime(closes)} unless someone resumes it.`
        : null;

  return (
    <div
      role="status"
      aria-label="Paused"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded border border-sky-300/60 bg-sky-500/15 px-3 py-2 text-sm text-sky-100"
    >
      <p>
        {who} {when}
      </p>
      <div className="flex gap-2">
        {room.config.pauseEnabled && saved === null && (
          <button
            type="button"
            disabled={busy}
            onClick={onSaveForLater}
            className="rounded border border-sky-200/60 px-3 py-1 disabled:opacity-40"
          >
            Save for later
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onResume}
          className="rounded bg-sky-300 px-3 py-1 font-medium text-black disabled:opacity-40"
        >
          Resume
        </button>
      </div>
    </div>
  );
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
