/**
 * The handful of things a player can ask the server to do, with the store updated
 * to match.
 *
 * Separated from the components because this is where the sequencing lives — send,
 * wait for the ack, keep the seat only if it was granted — and that is worth
 * asserting without rendering anything. Components call these and render state;
 * they do not talk to the socket themselves.
 *
 * Every one of these returns rather than throws, because the protocol models a
 * refused request as a value. A rejection is put on the store as a notice for the
 * interface to surface, and the caller learns whether it worked.
 */
import type { Action, MeldPlay, RoomOptions, SeatCredentials } from "@hf/shared";
import { clearCredentials } from "./credentials";
import { normalizeRoomCode } from "./roomCode";
import * as wire from "./socket";
import type { HfClientSocket } from "./socket";

/** The slice of the store these need. */
export interface ActionSink {
  seat(credentials: SeatCredentials): void;
  setNotice(notice: string | null): void;
}

/**
 * Open a table and take the first seat.
 *
 * Returns the room id, which the caller needs in order to navigate to it, or null
 * if the server refused.
 */
export async function createTable(
  socket: HfClientSocket,
  name: string,
  options: RoomOptions,
  sink: ActionSink,
): Promise<string | null> {
  const result = await wire.createRoom(socket, name.trim(), options);
  if (!result.ok) {
    sink.setNotice(result.error);
    return null;
  }
  sink.seat(result.data);
  sink.setNotice(null);
  return result.data.roomId;
}

/** Sit down at an existing table. Returns the room id, or null if refused. */
export async function joinTable(
  socket: HfClientSocket,
  roomId: string,
  name: string,
  sink: ActionSink,
): Promise<string | null> {
  const result = await wire.joinRoom(socket, normalizeRoomCode(roomId), name.trim());
  if (!result.ok) {
    sink.setNotice(result.error);
    return null;
  }
  sink.seat(result.data);
  sink.setNotice(null);
  return result.data.roomId;
}

/**
 * Ask for a seat back, and say which of three things happened.
 *
 * This is what makes a reload — or a phone that locked itself — recoverable
 * rather than a lost place at the table, and what keeps the seat across a dropped
 * connection.
 *
 * "gone" and "unreachable" are kept apart because they call for opposite
 * responses. A refusal means the seat no longer exists — the round finished, the
 * room was reaped, or the token predates a server that lost its tables — so the
 * credentials are dead and are discarded. No answer at all means only that the
 * connection is bad, and discarding the credentials then would turn a slow network
 * into a lost game.
 */
export async function reclaimSeat(
  socket: HfClientSocket,
  credentials: SeatCredentials,
  sink: Pick<ActionSink, "seat">,
): Promise<"reclaimed" | "gone" | "unreachable"> {
  const result = await wire.resumeSeat(socket, credentials);
  if (result.ok) {
    // The server's seat, not the stored one: seats close up when someone ahead
    // leaves the lobby, so the number saved at join time may no longer be ours.
    sink.seat(result.data);
    return "reclaimed";
  }
  if (result.error === wire.NO_RESPONSE) return "unreachable";
  clearCredentials();
  return "gone";
}

/** What `reclaimOnReconnect` needs from the store. */
export interface ReconnectSink extends ActionSink {
  /** Read at the moment of reconnecting, not when the listener was attached. */
  credentials(): SeatCredentials | null;
  leave(): void;
}

/** Shown when a table this tab was sitting at did not survive the reconnect. */
export const TABLE_GONE = "that table is no longer available";

/**
 * Hold on to the seat across a dropped connection.
 *
 * A new transport connection is a new socket to the server, and a seat belongs to
 * a socket only once it has presented the token. Without this, a network blip —
 * or every deploy of the server, which restarts it — leaves the tab showing a
 * connected table whose every move is refused as "not seated", while the server,
 * seeing the seat empty, starts playing it on the player's behalf.
 *
 * The first connection is left alone: a fresh load has no seat in the store yet,
 * and reclaiming the stored one is `ResumeSeat`'s job. Returns a teardown, for the
 * same reason `attachSession` does.
 */
export function reclaimOnReconnect(socket: HfClientSocket, sink: ReconnectSink): () => void {
  const onConnect = (): void => {
    const credentials = sink.credentials();
    if (!credentials) return;
    void reclaimSeat(socket, credentials, sink).then((outcome) => {
      // Unreachable keeps the seat: the next reconnect tries again.
      if (outcome !== "gone") return;
      // Unlike a fresh load, the player was at this table a moment ago, so its
      // disappearing is worth saying out loud rather than silently going home.
      sink.leave();
      sink.setNotice(TABLE_GONE);
    });
  };
  socket.on("connect", onConnect);
  return () => {
    socket.off("connect", onConnect);
  };
}

/**
 * Get up from the table, telling the server so the seat is freed — or, once dealt,
 * played for — rather than held by a player who is no longer there.
 *
 * The local seat is forgotten whatever the server says. A refusal or a timeout
 * means the server already has no seat for this socket, or cannot be reached, and
 * in neither case should the player be kept at a table they asked to leave.
 */
export async function leaveTable(socket: HfClientSocket, sink: { leave(): void }): Promise<void> {
  await wire.leaveRoom(socket);
  sink.leave();
}

/** Hand hosting to another player in the lobby. Only the host's client offers this. */
export async function makeHost(
  socket: HfClientSocket,
  seat: number,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.setHost(socket, seat);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/** Deal the first round. Only the host's client offers this. */
export async function startTable(socket: HfClientSocket, sink: ActionSink): Promise<boolean> {
  const result = await wire.startGame(socket);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/** Submit a move. A rule violation comes back as a notice, not an error. */
export async function play(
  socket: HfClientSocket,
  action: Action,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.submitAction(socket, action);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/** Freeze or restart the table's clock. Refused outright in competitive mode. */
export async function pauseTable(
  socket: HfClientSocket,
  paused: boolean,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.setPaused(socket, paused);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/**
 * Keep the server's copy of the lay-down being built, so that a turn clock running
 * out plays it rather than losing it. Nothing is reported either way: the player
 * did not ask for this, and a draft that did not arrive only means the timeout
 * falls back to what it did before.
 */
export async function stageDraft(
  socket: HfClientSocket,
  melds: readonly MeldPlay[],
): Promise<void> {
  await wire.stageMelds(socket, melds);
}

/**
 * Leave a finished table for the next game's waiting room. The seat there replaces
 * the one here — everything about the old table is forgotten — and the caller gets
 * the new room's id to go to. A refusal (the next game started without them) is a
 * notice, and the player stays where they are.
 */
export async function playAgain(
  socket: HfClientSocket,
  sink: ActionSink & { leave(): void },
): Promise<string | null> {
  const result = await wire.playAgain(socket);
  if (!result.ok) {
    sink.setNotice(result.error);
    return null;
  }
  sink.leave();
  sink.seat(result.data);
  return result.data.roomId;
}
