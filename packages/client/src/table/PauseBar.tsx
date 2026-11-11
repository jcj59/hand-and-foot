/**
 * What a paused table is waiting for: who paused it, or that it paused itself,
 * and when it will be closed if nobody resumes it — with the way to resume, and
 * for a family game the way to keep it for another day. A game saved for later
 * is not shown as a table at all but as its own waiting room (`SavedGame`), so
 * this is only ever a pause for a break.
 *
 * The closing time is shown as a clock time rather than a countdown: it is half
 * an hour away, and a countdown would tick for no reason. It is the server's
 * time, so it is read through the session's clock offset, as the turn clock's
 * deadline is.
 */
import type { RoomInfo } from "@hf/shared";
import { useSession } from "../session";

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
  const serverClock = useSession((s) => s.clock);
  const paused = room.pausedBy !== undefined || room.idlePaused === true;
  if (!paused) return null;

  const who = room.idlePaused
    ? "Paused because nobody has played for a full lap."
    : `${nameOf(room.pausedBy!)} paused the table.`;
  const closes = room.closesAt ?? null;
  const when =
    closes !== null
      ? `It closes at ${formatTime(serverClock.toLocal(closes))} unless someone resumes it.`
      : null;

  return (
    <div
      role="status"
      aria-label="Paused"
      className="mx-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-blue/50 bg-blue/14 px-3 py-2.5 text-[13px] leading-snug text-[#D6E5F7] md:mx-6 md:mt-3"
    >
      <p className="m-0 flex-[1_1_200px]">
        {who} {when}
      </p>
      <div className="flex gap-1.5">
        {room.config.pauseEnabled && (
          <button
            type="button"
            disabled={busy}
            onClick={onSaveForLater}
            className="min-h-10 rounded-xl border border-blue/60 bg-blue/8 px-3.5 text-sm font-semibold text-[#CFE0F5] disabled:opacity-40"
          >
            Save for later
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onResume}
          className="min-h-10 rounded-xl bg-accent px-3.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
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
