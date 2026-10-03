/**
 * The app shell: the routes, the socket wiring, and reclaiming a seat on load.
 *
 * The socket arrives as a prop rather than being reached for as a module singleton,
 * so a test can drive the whole shell with a fake transport — the same reason the
 * server injects its `Clock`.
 */
import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { CARRIED_ON_WITHOUT_YOU } from "@hf/shared";
import { leaveOnClose, reclaimOnReconnect, reclaimSeat } from "./actions";
import { ConnectionBanner } from "./ConnectionBanner";
import { loadCredentials } from "./credentials";
import { forgetSavedGame } from "./savedGames";
import { Home } from "./routes/Home";
import { Lobby } from "./routes/Lobby";
import { SavedGame } from "./routes/SavedGame";
import { Replay } from "./routes/Replay";
import { Table } from "./routes/Table";
import { HowToPlayPage } from "./rules/HowToPlay";
import { LessonList, LessonPage } from "./learn/Learn";
import { attachSession, useSession } from "./session";
import type { HfClientSocket } from "./socket";
import { installAudio } from "./table/audio";

export interface AppProps {
  readonly socket: HfClientSocket;
}

export function App({ socket }: AppProps): React.ReactElement {
  const setStatus = useSession((s) => s.setStatus);
  const applyRoom = useSession((s) => s.applyRoom);
  const applyUpdate = useSession((s) => s.applyUpdate);
  const applyResult = useSession((s) => s.applyResult);
  const reseat = useSession((s) => s.reseat);
  const applyReaction = useSession((s) => s.applyReaction);
  const seat = useSession((s) => s.seat);
  const leave = useSession((s) => s.leave);
  const setNotice = useSession((s) => s.setNotice);
  const navigate = useNavigate();

  useEffect(
    // The teardown is the function `attachSession` returns, so a remount detaches
    // rather than stacking a second set of listeners that apply each update twice.
    () =>
      attachSession(socket, {
        setStatus,
        applyRoom,
        applyUpdate,
        applyResult,
        reseat,
        applyReaction,
      }),
    [socket, setStatus, applyRoom, applyUpdate, applyResult, reseat, applyReaction],
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

  // Audio may only start after a gesture; listening from the first screen means
  // the lobby's clicks count, so a table opens able to make sound.
  useEffect(installAudio, []);

  useEffect(
    () =>
      leaveOnClose(socket, {
        leave: () => {
          // A closed table is gone for good, saved or not: nothing to come back to.
          const closed = useSession.getState().credentials?.roomId;
          if (closed) forgetSavedGame(closed);
          leave();
        },
        setNotice,
        goHome: () => navigate("/"),
      }),
    [socket, leave, setNotice, navigate],
  );

  return (
    // The window is the frame: the table fits inside it rather than growing a page
    // to scroll, and the other screens scroll within it when they need to.
    <div className="flex h-dvh flex-col bg-felt-900 text-white">
      <ConnectionBanner />
      <ResumeSeat socket={socket} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Home socket={socket} />} />
          <Route path="/room/:roomId" element={<RoomRoute socket={socket} />} />
          <Route path="/rules" element={<HowToPlayPage />} />
          <Route path="/learn" element={<LessonList />} />
          <Route path="/learn/:lessonId" element={<LessonPage />} />
          <Route path="/replay/:matchId" element={<Replay />} />
          {/* Anything else is a mistyped or stale URL; the home screen is recoverable. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
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
 * seat they had forgotten about is gone would be noise. The exception is a match
 * that went on without them: the table is still there, so the join form it shows
 * would otherwise be the only answer to why they are not in the game.
 */
function ResumeSeat({ socket }: { readonly socket: HfClientSocket }): null {
  const status = useSession((s) => s.status);
  const seat = useSession((s) => s.seat);
  const setNotice = useSession((s) => s.setNotice);
  const credentials = useSession((s) => s.credentials);
  // The page it has settled for, so arriving at another page — the table, from
  // the home screen's Rejoin — asks afresh.
  const [triedFor, setTriedFor] = useState<string | null>(null);
  // One request per connection: a re-render while it is in flight must not ask
  // again, but a new connection must.
  const asked = useRef(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (status !== "connected") {
      asked.current = false;
      return;
    }
    if (triedFor === pathname || asked.current) return;
    // A seat already held in this tab needs no reclaiming; this is for a fresh load.
    if (credentials) {
      setTriedFor(pathname);
      return;
    }
    const stored = loadCredentials();
    // Only the table's own page takes the player back to it. Reloading the home
    // screen leaves them there, with its Rejoin offering the way back — being
    // pulled into a game they had stepped away from is not what a reload means.
    if (!stored || pathname.toUpperCase() !== `/ROOM/${stored.roomId.toUpperCase()}`) {
      setTriedFor(pathname);
      return;
    }
    asked.current = true;
    void reclaimSeat(socket, stored, { seat }).then((outcome) => {
      if (outcome === "unreachable") return;
      if (outcome === "removed") setNotice(CARRIED_ON_WITHOUT_YOU);
      asked.current = false;
      setTriedFor(pathname);
      // The table URL as the server spells it, in case it was typed in lower case.
      if (outcome === "reclaimed") navigate(`/room/${stored.roomId}`, { replace: true });
    });
  }, [triedFor, pathname, status, credentials, socket, seat, setNotice, navigate]);

  return null;
}

/**
 * One URL for a table, showing whichever stage it is at.
 *
 * A visitor with no seat gets the join form with the code already filled in, which
 * is what arriving from a shared link looks like. Once seated, the room's own
 * `started` flag decides between the lobby and the table — the server owns that
 * transition, so the client reads it rather than tracking it. A game saved for
 * later is a waiting room of its own until the host picks it back up, whether the
 * player was at the table when it was saved or came back to it days later.
 */
function RoomRoute({ socket }: { readonly socket: HfClientSocket }): React.ReactElement {
  const credentials = useSession((s) => s.credentials);
  const room = useSession((s) => s.room);

  if (!credentials) return <Home socket={socket} />;
  if (room?.started && room.savedUntil != null) return <SavedGame socket={socket} />;
  if (room?.started) return <Table socket={socket} />;
  return <Lobby socket={socket} />;
}
