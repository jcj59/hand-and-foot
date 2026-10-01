/**
 * A game saved for later: the waiting room it becomes until its host picks it
 * back up.
 *
 * Everyone at the table when it is saved lands here, and so does everyone who
 * comes back to it from the home screen's saved games, days later. It shows who
 * is back, so the host can wait for the whole table before starting the clock
 * again — the cards are not shown, because nothing can be played until then.
 *
 * Who may resume mirrors the server's rule rather than restating its reasoning:
 * the host, or anyone at all once the host is not here. Leaving here keeps the
 * seat — the server holds it for whoever saved the game — so it can be left as
 * often as it is come back to.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { leaveTable, pauseTable } from "../actions";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";

export interface SavedGameProps {
  readonly socket: HfClientSocket;
}

export function SavedGame({ socket }: SavedGameProps): React.ReactElement | null {
  const room = useSession((s) => s.room);
  const update = useSession((s) => s.update);
  const credentials = useSession((s) => s.credentials);
  const notice = useSession((s) => s.notice);
  const setNotice = useSession((s) => s.setNotice);
  const seat = useSession((s) => s.seat);
  const leave = useSession((s) => s.leave);
  const serverClock = useSession((s) => s.clock);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  /* v8 ignore next -- only routed here once a room says it is saved */
  if (!room || room.savedUntil == null) return null;

  const nameOf = (s: number): string => room.players.find((p) => p.seat === s)?.name ?? `Seat ${s}`;
  const host = room.players.find((p) => p.seat === room.hostSeat);
  const mine = credentials?.seat;
  const isHost = mine === room.hostSeat;
  const canResume = isHost || !host?.connected;
  const away = room.players.filter((p) => !p.connected);
  const round = update?.view.roundNumber;
  const scores = update?.view.scoresSoFar ?? [];

  const resume = (): void => {
    setBusy(true);
    void pauseTable(socket, false, { seat, setNotice }).finally(() => setBusy(false));
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Saved game</h1>
        <p className="text-sm text-white/60">
          Table {room.roomId}
          {round !== undefined && ` · round ${round} of ${room.config.rounds}`} · kept until{" "}
          {formatDay(serverClock.toLocal(room.savedUntil))}
        </p>
      </header>

      <p className="text-sm text-white/80">
        Everyone can leave now and come back from <strong>Saved games</strong> on the home screen.
        When the players are back, {isHost ? "you pick" : `${host?.name ?? "the host"} picks`} the
        game up where it left off.
      </p>

      {scores.length > 0 && (
        <p aria-label="Scores so far" className="text-sm text-white/60">
          Scores so far: {scores.map((total, s) => `${nameOf(s)} ${total}`).join(" · ")}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-white/80">
          Back at the table ({room.players.length - away.length}/{room.players.length})
        </h2>
        <ul className="flex flex-col gap-1">
          {room.players.map((player) => (
            <li
              key={player.seat}
              className="flex items-center gap-2 rounded bg-black/20 px-3 py-2 text-sm"
            >
              <span
                aria-label={player.connected ? "back" : "not back yet"}
                className={`h-2 w-2 rounded-full ${
                  player.connected ? "bg-emerald-400" : "bg-white/25"
                }`}
              />
              <span className={`flex-1 ${player.connected ? "" : "text-white/50"}`}>
                {player.name}
              </span>
              {player.seat === room.hostSeat && <span className="text-xs text-white/40">host</span>}
              {player.seat === mine && <span className="text-xs text-white/40">you</span>}
            </li>
          ))}
        </ul>
      </section>

      {notice && (
        <p role="alert" className="rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {notice}
        </p>
      )}

      {canResume ? (
        <div className="flex flex-col gap-2">
          {!isHost && (
            <p className="text-sm text-white/60">
              {host?.name ?? "The host"} is not here, so anyone at the table can pick the game back
              up.
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={resume}
            className="rounded bg-sky-300 px-4 py-2 font-medium text-black disabled:opacity-40"
          >
            {away.length === 0
              ? "Resume the game"
              : `Resume without ${away.map((p) => p.name).join(", ")}`}
          </button>
          {away.length > 0 && (
            // Starting without someone is allowed — they may not be coming — but
            // their turns are then played for them once their grace runs out.
            <p className="text-xs text-white/50">
              Anyone not back yet has their turns played for them until they return.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-white/60">Waiting for {host?.name} to resume the game.</p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void leaveTable(socket, { leave }).then(() => navigate("/"));
        }}
        className="self-start text-sm text-white/50 underline"
      >
        Leave for now
      </button>
    </main>
  );
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
