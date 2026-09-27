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
import type { Action, RoomOptions, SeatCredentials } from "@hf/shared";
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
 * Reclaim a stored seat, which is what makes a reload — or a phone that locked
 * itself — recoverable rather than a lost place at the table.
 *
 * A refusal here is expected rather than exceptional: the round may have finished,
 * the room may have been reaped, or the token may be from an older session. So the
 * credentials are discarded instead of being retried forever, and deliberately no
 * notice is raised — the player did not ask for this, and telling them a seat they
 * had forgotten about is gone would be noise.
 */
export async function resumeStoredSeat(
  socket: HfClientSocket,
  credentials: SeatCredentials,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.resumeSeat(socket, credentials);
  if (result.ok) {
    sink.seat(credentials);
    return true;
  }
  clearCredentials();
  return false;
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
