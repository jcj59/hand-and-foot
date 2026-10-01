/**
 * The waiting room: who is here, how to invite the rest, and the button that deals.
 *
 * Only the host's client offers Deal, mirroring the server's rule rather than
 * duplicating its reasoning — `hostSeat` says whose it is. The seat count gates it
 * too, because the server refuses under two players and an enabled button that
 * bounces is worse than one that explains itself.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MAX_PLAYERS, MIN_PLAYERS } from "@hf/shared";
import { leaveTable, makeHost, startTable } from "../actions";
import { roomLink } from "../roomCode";
import { RulesSummary } from "../rules/RulesSummary";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";

export interface LobbyProps {
  readonly socket: HfClientSocket;
}

export function Lobby({ socket }: LobbyProps): React.ReactElement {
  const room = useSession((s) => s.room);
  const credentials = useSession((s) => s.credentials);
  const setNotice = useSession((s) => s.setNotice);
  const seat = useSession((s) => s.seat);
  const notice = useSession((s) => s.notice);
  const leave = useSession((s) => s.leave);
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // The room event is what populates this, and it arrives just after the seat is
  // granted, so a moment of nothing is normal rather than an error.
  if (!room) {
    return (
      <main className="mx-auto w-full max-w-md p-6 text-white/60">Joining the table&hellip;</main>
    );
  }

  const isHost = credentials?.seat === room.hostSeat;
  const enough = room.players.length >= MIN_PLAYERS;
  const link = roomLink(room.roomId, window.location.origin);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an insecure
      // origin, a permission prompt declined. The link is on screen to be copied
      // by hand, so this is not worth an error.
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Table {room.roomId}</h1>
        <p className="text-sm text-white/60">
          {room.config.rounds} round{room.config.rounds === 1 ? "" : "s"}.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-white/80">Invite</h2>
        <div className="flex gap-2">
          <input
            readOnly
            aria-label="Shareable table link"
            value={link}
            className="min-w-0 flex-1 rounded border border-white/20 bg-black/20 px-3 py-2 text-xs text-white/70"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded border border-white/30 px-3 py-2 text-sm"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-white/80">
          Players ({room.players.length}/{MAX_PLAYERS})
        </h2>
        <ul className="flex flex-col gap-1">
          {room.players.map((player) => (
            <li
              key={player.seat}
              className="flex items-center gap-2 rounded bg-black/20 px-3 py-2 text-sm"
            >
              <span
                // Connection state is shown in the lobby because it matters later:
                // once dealt, a seat that has dropped has its turns played for it.
                aria-label={player.connected ? "connected" : "disconnected"}
                className={`h-2 w-2 rounded-full ${
                  player.connected ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <span className="flex-1">{player.name}</span>
              {player.seat === room.hostSeat && <span className="text-xs text-white/40">host</span>}
              {/* The host can hand the deal to someone else — the person who will
                  actually be at the keyboard when everyone is ready, say. */}
              {isHost && player.seat !== room.hostSeat && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void makeHost(socket, player.seat, { seat, setNotice }).finally(() =>
                      setBusy(false),
                    );
                  }}
                  aria-label={`Make ${player.name} the host`}
                  className="rounded border border-white/25 px-2 py-0.5 text-xs text-white/70 disabled:opacity-40"
                >
                  Make host
                </button>
              )}
              {player.seat === credentials?.seat && (
                <span className="text-xs text-white/40">you</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <RulesSummary config={room.config} />

      {notice && (
        <p role="alert" className="rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {notice}
        </p>
      )}

      {isHost ? (
        <button
          type="button"
          disabled={busy || !enough}
          onClick={() => {
            setBusy(true);
            void startTable(socket, { seat, setNotice }).finally(() => setBusy(false));
          }}
          className="rounded bg-white px-4 py-2 font-medium text-felt-900 disabled:opacity-40"
        >
          {enough ? "Deal" : `Waiting for ${MIN_PLAYERS - room.players.length} more`}
        </button>
      ) : (
        <p className="text-sm text-white/50">Waiting for the host to deal.</p>
      )}

      <button
        type="button"
        // Without this the stored credentials are a trap: a seat at a table that
        // never deals would be reclaimed on every load with no way to get out.
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void leaveTable(socket, { leave }).then(() => navigate("/"));
        }}
        className="self-start text-sm text-white/50 underline"
      >
        Leave this table
      </button>
    </main>
  );
}
