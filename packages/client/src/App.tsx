/**
 * The app shell: the routes, the socket wiring, and reclaiming a seat on load.
 *
 * The socket arrives as a prop rather than being reached for as a module singleton,
 * so a test can drive the whole shell with a fake transport — the same reason the
 * server injects its `Clock`.
 */
import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { reclaimOnReconnect, reclaimSeat } from "./actions";
import { ConnectionBanner } from "./ConnectionBanner";
import { loadCredentials } from "./credentials";
import { Home } from "./routes/Home";
import { Lobby } from "./routes/Lobby";
import { Table } from "./routes/Table";
import { attachSession, useSession } from "./session";
import type { HfClientSocket } from "./socket";

export interface AppProps {
  readonly socket: HfClientSocket;
}

export function App({ socket }: AppProps): React.ReactElement {
  const setStatus = useSession((s) => s.setStatus);
  const applyRoom = useSession((s) => s.applyRoom);
  const applyUpdate = useSession((s) => s.applyUpdate);
  const applyResult = useSession((s) => s.applyResult);
  const reseat = useSession((s) => s.reseat);
  const seat = useSession((s) => s.seat);
  const leave = useSession((s) => s.leave);
  const setNotice = useSession((s) => s.setNotice);

  useEffect(
    // The teardown is the function `attachSession` returns, so a remount detaches
    // rather than stacking a second set of listeners that apply each update twice.
    () => attachSession(socket, { setStatus, applyRoom, applyUpdate, applyResult, reseat }),
    [socket, setStatus, applyRoom, applyUpdate, applyResult, reseat],
  );

  useEffect(
    () =>
      reclaimOnReconnect(socket, {
        // Read when the connection comes back, not captured now: the seat is taken
        // long after this effect runs.
        credentials: () => useSession.getState().credentials,
        seat,
        leave,
        setNotice,
      }),
    [socket, seat, leave, setNotice],
  );

  return (
    <div className="flex min-h-full flex-col bg-felt-900 text-white">
      <ConnectionBanner />
      <ResumeSeat socket={socket} />
      <Routes>
        <Route path="/" element={<Home socket={socket} />} />
        <Route path="/room/:roomId" element={<RoomRoute socket={socket} />} />
        {/* Anything else is a mistyped or stale URL; the home screen is recoverable. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

/**
 * Reclaim the stored seat once the socket is up, then get out of the way.
 *
 * Rendered as a component rather than an effect in `App` so it can wait for the
 * connection without re-running the whole shell, and it draws nothing.
 *
 * It stops once it has an answer. A refusal means the seat is genuinely gone —
 * the round finished, the room was reaped, or the token predates a restart — and
 * `reclaimSeat` discards the credentials, so a second attempt could only fail
 * again. No answer is different: the credentials are kept and the next connection
 * asks again, because until the seat is in the store the reconnect path has nothing
 * to reclaim, and giving up here would leave the server playing the seat.
 *
 * A refusal raises no notice: the player did not ask for this, and telling them a
 * seat they had forgotten about is gone would be noise.
 */
function ResumeSeat({ socket }: { readonly socket: HfClientSocket }): null {
  const status = useSession((s) => s.status);
  const seat = useSession((s) => s.seat);
  const credentials = useSession((s) => s.credentials);
  const [tried, setTried] = useState(false);
  // One request per connection: a re-render while it is in flight must not ask
  // again, but a new connection must.
  const asked = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (status !== "connected") {
      asked.current = false;
      return;
    }
    if (tried || asked.current) return;
    // A seat already held in this tab needs no reclaiming; this is for a fresh load.
    if (credentials) {
      setTried(true);
      return;
    }
    const stored = loadCredentials();
    if (!stored) {
      setTried(true);
      return;
    }
    asked.current = true;
    void reclaimSeat(socket, stored, { seat }).then((outcome) => {
      if (outcome === "unreachable") return;
      setTried(true);
      // Back to the table they were at. Reloading the table URL makes this a no-op;
      // reloading the home screen returns them to a game still in progress.
      if (outcome === "reclaimed") navigate(`/room/${stored.roomId}`, { replace: true });
    });
  }, [tried, status, credentials, socket, seat, navigate]);

  return null;
}

/**
 * One URL for a table, showing whichever stage it is at.
 *
 * A visitor with no seat gets the join form with the code already filled in, which
 * is what arriving from a shared link looks like. Once seated, the room's own
 * `started` flag decides between the lobby and the table — the server owns that
 * transition, so the client reads it rather than tracking it.
 */
function RoomRoute({ socket }: { readonly socket: HfClientSocket }): React.ReactElement {
  const credentials = useSession((s) => s.credentials);
  const room = useSession((s) => s.room);

  if (!credentials) return <Home socket={socket} />;
  if (room?.started) return <Table socket={socket} />;
  return <Lobby socket={socket} />;
}
