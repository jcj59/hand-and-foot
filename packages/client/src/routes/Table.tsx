/**
 * The table, as a seated player sees it: the latest `ViewUpdate` from the session,
 * and moves sent over the socket. Everything on screen is `TableView`'s; this
 * only connects it to the server.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  leaveTable,
  pauseTable,
  play,
  playAgain,
  readyForNextRound,
  saveTableForLater,
  stageDraft,
} from "../actions";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { TableView, type TableControls } from "../table/TableView";

export interface TableProps {
  readonly socket: HfClientSocket;
}

export function Table({ socket }: TableProps): React.ReactElement {
  const update = useSession((s) => s.update);
  const notice = useSession((s) => s.notice);
  const setNotice = useSession((s) => s.setNotice);
  const seat = useSession((s) => s.seat);
  const result = useSession((s) => s.result);
  // The room on its own, not only as it came with the last view: who is connected,
  // and who has gone on to the next game, arrive as room broadcasts with no new view.
  const latestRoom = useSession((s) => s.room);
  const leave = useSession((s) => s.leave);
  const navigate = useNavigate();

  // Stable while the socket and store are, since the table re-sends its draft
  // whenever these change.
  const controls = useMemo((): TableControls => {
    const sink = { seat, setNotice };
    return {
      play: (action) => play(socket, action, sink),
      stageDraft: (melds) => void stageDraft(socket, melds),
      pause: (paused) => pauseTable(socket, paused, sink),
      saveForLater: () => saveTableForLater(socket, sink),
      // A real leave, not just forgetting the seat: the server then knows the
      // table is empty and lets it go.
      leave: () => void leaveTable(socket, { leave }).then(() => navigate("/")),
      playAgain: () =>
        void playAgain(socket, { ...sink, leave }).then((roomId) => {
          if (roomId) navigate(`/room/${roomId}`);
        }),
      nextRound: () => void readyForNextRound(socket, sink),
    };
  }, [socket, seat, setNotice, leave, navigate]);

  // Between the deal being ordered and the first view arriving there is nothing to
  // draw. Normal, not a fault.
  if (!update) {
    return <main className="p-6 text-white/60">Dealing&hellip;</main>;
  }

  return (
    <TableView
      update={update}
      room={latestRoom ?? update.room}
      result={result}
      notice={notice}
      controls={controls}
      onMainMenu={() => navigate("/")}
    />
  );
}
