/**
 * The app shell: the routes, and the one place the socket is wired to the store.
 *
 * The socket arrives as a prop rather than being reached for as a module
 * singleton, so a test can drive the whole shell with a fake transport — the same
 * reason the server injects its `Clock`.
 *
 * The routes are placeholders in M3a. The lobby lands in M3b and the table in
 * M3c; what is real here is the plumbing underneath them.
 */
import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { ConnectionBanner } from "./ConnectionBanner";
import { attachSession, useSession, type SessionSocket } from "./session";

export interface AppProps {
  readonly socket: SessionSocket;
}

export function App({ socket }: AppProps): React.ReactElement {
  const setStatus = useSession((s) => s.setStatus);
  const applyRoom = useSession((s) => s.applyRoom);
  const applyUpdate = useSession((s) => s.applyUpdate);
  const applyResult = useSession((s) => s.applyResult);

  useEffect(
    // The teardown is the function `attachSession` returns, so a remount detaches
    // rather than stacking a second set of listeners that apply each update twice.
    () => attachSession(socket, { setStatus, applyRoom, applyUpdate, applyResult }),
    [socket, setStatus, applyRoom, applyUpdate, applyResult],
  );

  return (
    <div className="flex min-h-full flex-col bg-felt-900 text-white">
      <ConnectionBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Table />} />
      </Routes>
    </div>
  );
}

/** Placeholder for the lobby (M3b). */
function Home(): React.ReactElement {
  const room = useSession((s) => s.room);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Hand and Foot</h1>
      <p className="text-white/70">
        {room ? `Seated at table ${room.roomId}.` : "Creating and joining a table lands in M3b."}
      </p>
    </main>
  );
}

/** Placeholder for the table (M3c). */
function Table(): React.ReactElement {
  const update = useSession((s) => s.update);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Table</h1>
      <p className="text-white/70">
        {update
          ? `Round ${update.view.roundNumber}, seat ${update.hints.seatToAct} to act.`
          : "Waiting for the game to start."}
      </p>
    </main>
  );
}
