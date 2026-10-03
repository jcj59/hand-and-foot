/**
 * Watching a table without a seat, from its watch link: `/watch/<code>`.
 *
 * The table as anyone at the table can see it and no more — every hand hidden —
 * which is the server's to decide: a spectator is sent its own projection, with
 * no hand or foot in it at all. Nothing can be clicked. Before the deal it shows
 * who is waiting; after the match, the final scores.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../session";
import * as wire from "../socket";
import type { HfClientSocket } from "../socket";
import { normalizeRoomCode } from "../roomCode";
import { TableView } from "../table/TableView";

export interface WatchProps {
  readonly socket: HfClientSocket;
}

export function Watch({ socket }: WatchProps): React.ReactElement {
  const { roomId = "" } = useParams();
  const code = normalizeRoomCode(roomId);
  const navigate = useNavigate();
  const room = useSession((s) => s.room);
  const update = useSession((s) => s.update);
  const result = useSession((s) => s.result);
  const reactions = useSession((s) => s.reactions);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const watch = (): void => {
      void wire.watchRoom(socket, code).then((answer) => {
        if (live && !answer.ok) setRefused(answer.error);
      });
    };
    watch();
    // A dropped connection comes back as a new one, which watches nothing until asked.
    let first = true;
    const onConnect = (): void => {
      if (first) {
        first = false;
        return;
      }
      watch();
    };
    socket.on("connect", onConnect);
    return () => {
      live = false;
      socket.off("connect", onConnect);
      // Let go of the table, and of what was shown of it; a seat stored for another
      // table is left alone.
      void wire.leaveRoom(socket);
      useSession.setState({ room: null, update: null, result: null, reactions: [] });
    };
  }, [socket, code]);

  if (refused) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Watch table {code}</h1>
        <p role="alert" className="rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {refused === "no room with that code"
            ? "There is no table with that code. It may have finished and closed."
            : refused}
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="self-start rounded bg-white px-4 py-2 font-medium text-felt-900"
        >
          Back to the main screen
        </button>
      </main>
    );
  }
  if (!room || room.roomId !== code) {
    return <main className="p-6 text-white/60">Finding table {code}&hellip;</main>;
  }
  if (!update) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Watching table {code}</h1>
        <p className="text-sm text-white/70">
          The game has not been dealt yet. It will appear here when it is.
        </p>
        <ul aria-label="Waiting to play" className="flex flex-col gap-1">
          {room.players.map((p) => (
            <li key={p.seat} className="rounded bg-black/20 px-3 py-2 text-sm">
              {p.name}
              {p.bot && <span className="ml-2 text-xs text-sky-200/80">computer</span>}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="self-start text-sm text-white/50 underline"
        >
          Stop watching
        </button>
      </main>
    );
  }
  return (
    <TableView
      update={update}
      room={room}
      result={result}
      notice={null}
      controls={null}
      onMainMenu={() => navigate("/")}
      heading={`Watching table ${code}`}
      reactions={reactions}
    />
  );
}
