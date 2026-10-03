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
import { CARRIED_ON_WITHOUT_YOU } from "@hf/shared";
import type {
  Action,
  Avatar,
  CloseReason,
  MeldPlay,
  ReactionId,
  RoomOptions,
  SeatCredentials,
  UserCredentials,
} from "@hf/shared";
import { clearCredentials } from "./credentials";
import { forgetSavedGame } from "./savedGames";
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
  user?: UserCredentials | null,
  avatar?: Avatar | null,
): Promise<string | null> {
  const result = await wire.createRoom(socket, name.trim(), options, user, avatar);
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
  user?: UserCredentials | null,
  avatar?: Avatar | null,
): Promise<string | null> {
  const result = await wire.joinRoom(socket, normalizeRoomCode(roomId), name.trim(), user, avatar);
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
): Promise<"reclaimed" | "gone" | "removed" | "unreachable"> {
  const result = await wire.resumeSeat(socket, credentials);
  if (result.ok) {
    // The server's seat, not the stored one: seats close up when someone ahead
    // leaves the lobby, so the number saved at join time may no longer be ours.
    sink.seat(result.data);
    return "reclaimed";
  }
  if (result.error === wire.NO_RESPONSE) return "unreachable";
  clearCredentials();
  // Gone in a way worth telling the player, whenever they find out: the table is
  // still there, and the match went on without them.
  return result.error === CARRIED_ON_WITHOUT_YOU ? "removed" : "gone";
}

/** Shown when a game saved for later is no longer there to go back to. */
export const SAVED_GAME_GONE = "that saved game is no longer available";

/**
 * Go back to a game saved for later, from the home screen's list.
 *
 * Not `reclaimSeat`: that discards the stored seat on a refusal, and the seat
 * stored is not necessarily this game's — the player may have sat down somewhere
 * else since saving it. A refusal here forgets only this saved game.
 */
export async function resumeSavedGame(
  socket: HfClientSocket,
  game: SeatCredentials,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.resumeSeat(socket, {
    roomId: game.roomId,
    seat: game.seat,
    token: game.token,
  });
  if (result.ok) {
    sink.seat(result.data);
    sink.setNotice(null);
    return true;
  }
  if (result.error === wire.NO_RESPONSE) {
    sink.setNotice(result.error);
    return false;
  }
  forgetSavedGame(game.roomId);
  sink.setNotice(
    result.error === CARRIED_ON_WITHOUT_YOU ? CARRIED_ON_WITHOUT_YOU : SAVED_GAME_GONE,
  );
  return false;
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
      if (outcome !== "gone" && outcome !== "removed") return;
      // Unlike a fresh load, the player was at this table a moment ago, so its
      // disappearing is worth saying out loud rather than silently going home.
      sink.leave();
      sink.setNotice(outcome === "removed" ? CARRIED_ON_WITHOUT_YOU : TABLE_GONE);
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
 * Send a quick reaction. A refusal — sending too many too quickly — is not worth a
 * notice: the client's own cooldown makes it rare, and the reaction simply does
 * not appear. Returns whether it went.
 */
export async function sendReaction(socket: HfClientSocket, id: ReactionId): Promise<boolean> {
  return (await wire.react(socket, id)).ok;
}

/**
 * Keep this family table for a week, to be picked up again later. The server
 * pauses it too if it was not paused already, so this works mid-turn and between
 * rounds alike.
 */
export async function saveTableForLater(
  socket: HfClientSocket,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.saveForLater(socket);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/** What a player is told when the table they were at is closed. */
export function closedNotice(reason: CloseReason): string {
  switch (reason) {
    case "paused":
      return "The table was closed after being paused for 30 minutes.";
    case "saved":
      return "The saved game was closed after a week without being picked up.";
    case "abandoned":
      return "The table was closed because everyone had left.";
  }
}

/**
 * When the server closes the table this player is at, get up from it and go
 * home, saying why. Returns the teardown.
 */
export function leaveOnClose(
  socket: HfClientSocket,
  sink: { leave(): void; setNotice(notice: string | null): void; goHome(): void },
): () => void {
  const onClosed = ({ reason }: { readonly reason: CloseReason }): void => {
    // The socket is let go of too: the server has retired the table, so this
    // only stops the transport holding a connection to it.
    void wire.leaveRoom(socket);
    sink.leave();
    sink.goHome();
    sink.setNotice(closedNotice(reason));
  };
  socket.on("tableClosed", onClosed);
  return () => {
    socket.off("tableClosed", onClosed);
  };
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

/**
 * Deal the same table again, as the host: everyone moves to the new table, dealt
 * at once. The ack is the host's own seat there; the others are sent theirs.
 */
export async function rematch(
  socket: HfClientSocket,
  sink: ActionSink & { leave(): void },
): Promise<string | null> {
  const result = await wire.rematch(socket);
  if (!result.ok) {
    sink.setNotice(result.error);
    return null;
  }
  sink.leave();
  sink.seat(result.data);
  return result.data.roomId;
}

/**
 * Go along with a rematch the host dealt: take the seat the server sent, at the
 * new table, as a reclaim does. Returns the teardown.
 */
export function followRematch(
  socket: HfClientSocket,
  sink: ActionSink & { leave(): void; go(roomId: string): void },
): () => void {
  const onRematch = (seat: SeatCredentials): void => {
    void wire.resumeSeat(socket, seat).then((result) => {
      if (!result.ok) {
        sink.setNotice(result.error);
        return;
      }
      sink.leave();
      sink.seat(result.data);
      sink.go(result.data.roomId);
    });
  };
  socket.on("rematch", onRematch);
  return () => {
    socket.off("rematch", onRematch);
  };
}

/** Sit a computer player at the table. Only the host's client offers this. A refusal is a notice. */
export async function addComputerPlayer(
  socket: HfClientSocket,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.addBot(socket);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/** Take a computer player away again, before the deal. A refusal is a notice. */
export async function removeComputerPlayer(
  socket: HfClientSocket,
  seat: number,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.removeBot(socket, seat);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/**
 * Carry on without a player who has gone, between rounds. Only the host's client
 * offers this. A refusal is a notice.
 */
export async function carryOnWithout(
  socket: HfClientSocket,
  seat: number,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.removePlayer(socket, seat);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  sink.setNotice(null);
  return true;
}

/** Say ready for the next round of the match. A refusal is a notice. */
export async function readyForNextRound(
  socket: HfClientSocket,
  sink: ActionSink,
): Promise<boolean> {
  const result = await wire.readyForNextRound(socket);
  if (!result.ok) {
    sink.setNotice(result.error);
    return false;
  }
  return true;
}
