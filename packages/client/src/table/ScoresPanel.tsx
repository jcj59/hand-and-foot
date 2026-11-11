/**
 * The match so far and what just happened: every player's total over the rounds
 * finished, highest first, and the last few moves. Beside the table on a computer;
 * on a phone, a sheet behind the trophy in the header.
 *
 * The totals are what every later round is being played for, so they are always
 * a glance away rather than only between rounds.
 */
import type { RoomInfo } from "@hf/shared";
import { PlayerFace } from "./PlayerFace";

export interface ScoresPanelProps {
  readonly room: RoomInfo;
  /** Each seat's total over the rounds finished, by seat. */
  readonly totals: readonly number[];
  readonly mySeat: number;
  readonly departed: readonly { readonly seat: number }[];
  /** The last few moves, newest last. */
  readonly moves: readonly { readonly seq: number; readonly text: string }[];
  /** In a sheet titled "Scores so far" already, the panel's own heading would repeat it. */
  readonly titled?: boolean;
}

export function ScoresPanel({
  room,
  totals,
  mySeat,
  departed,
  moves,
  titled = false,
}: ScoresPanelProps): React.ReactElement {
  const gone = new Set(departed.map((d) => d.seat));
  const rows = room.players
    .map((p) => ({ player: p, total: totals[p.seat] ?? 0 }))
    // Players who have left go last, as on the scoreboard: their total is kept
    // but no longer counts for the win.
    .sort(
      (a, b) =>
        Number(gone.has(a.player.seat)) - Number(gone.has(b.player.seat)) || b.total - a.total,
    );
  const heading = "m-0 text-xs font-semibold tracking-[0.08em] text-faint uppercase";
  return (
    <div className="flex flex-col gap-3.5">
      {!titled && <h2 className={heading}>Scores so far</h2>}
      <ol aria-label="Scores so far" className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map(({ player, total }) => (
          <li
            key={player.seat}
            className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5"
          >
            <PlayerFace player={player} size={28} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {player.seat === mySeat ? "You" : player.name}
              {gone.has(player.seat) && <span className="text-xs text-muted"> (left)</span>}
            </span>
            <span className="font-display text-[15px] font-bold tabular-nums">
              {total.toLocaleString("en-US")}
            </span>
          </li>
        ))}
      </ol>
      {moves.length > 0 && (
        <>
          <h2 className={`${heading} mt-1.5`}>Latest moves</h2>
          <ol aria-label="Latest moves" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {moves.map((move, i) => (
              <li
                key={move.seq}
                className={`rounded-xl px-3 py-2.5 text-[13px] leading-snug ${
                  i === moves.length - 1
                    ? "border border-accent/40 bg-surface text-ink"
                    : "border border-white/5 text-muted"
                }`}
              >
                {move.text}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
