import type { Server, Socket } from "socket.io";
import type { Ack, ClientToServerEvents, SeatCredentials, ServerToClientEvents } from "@hf/shared";
import { configFor, type RoomManager } from "./manager";
import type { Room, RoomResult } from "./room";

export type HfServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type HfSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Which seat in which room a connected socket is holding.
 *
 * Held by token rather than seat number, because a lobby departure renumbers the
 * seats behind it; the token is the one thing about a seat that never changes.
 */
interface Session {
  readonly roomId: string;
  readonly token: string;
}

function ackOf<T>(result: RoomResult<T>): Ack<T> {
  return result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error };
}

/**
 * Wire a room manager onto a Socket.io server.
 *
 * Two rules shape everything here. First, the seat a socket may act as comes
 * from the server's own session table, never from the payload — otherwise any
 * client could submit actions as any seat, and the authoritative server would be
 * authoritative over nothing. Second, every broadcast goes out per-socket
 * through `viewFor(seat)`, because a single shared payload is exactly how hidden
 * cards leak.
 */
export function attachSocketServer(io: HfServer, manager: RoomManager): void {
  const sessions = new Map<string, Session>();

  /** Send each seat its own filtered view. Never build one payload for the table. */
  function broadcastViews(room: Room): void {
    for (const [socketId, session] of sessions) {
      if (session.roomId !== room.id) continue;
      const player = room.seatOf(session.token);
      /* v8 ignore next -- a departed token's sessions are dropped with it */
      const update = player ? room.viewFor(player.seat) : null;
      if (update) io.to(socketId).emit("view", update);
    }
  }

  function broadcastRoom(room: Room): void {
    const info = room.info();
    for (const [socketId, session] of sessions) {
      if (session.roomId === room.id) io.to(socketId).emit("room", info);
    }
  }

  function broadcastResult(room: Room): void {
    const result = room.result();
    if (!result) return;
    for (const [socketId, session] of sessions) {
      if (session.roomId === room.id) io.to(socketId).emit("roundEnded", result);
    }
  }

  /**
   * Make sure the room pushes to the table when the *server* moves.
   *
   * Timeouts and disconnect defaults change the game without any client having
   * asked for anything, so without this the table would silently fall behind
   * until somebody happened to act.
   */
  function wire(room: Room): Room {
    room.onChange = () => {
      broadcastViews(room);
      broadcastRoom(room);
      broadcastResult(room);
    };
    return room;
  }

  /** The room this socket is seated in, with its seat, or null if it has none. */
  function sessionOf(socket: HfSocket): { room: Room; seat: number } | null {
    const session = sessions.get(socket.id);
    if (!session) return null;
    const room = manager.get(session.roomId);
    if (!room) return null;
    const player = room.seatOf(session.token);
    /* v8 ignore next -- a departed token's sessions are dropped with it */
    if (!player) return null;
    return { room, seat: player.seat };
  }

  /**
   * The one socket that currently speaks for each seat, keyed by room and token.
   *
   * A reconnecting player resumes on a new socket before the server has noticed
   * the old one is dead, which can take a full ping timeout. Only the owner's
   * disconnect marks the seat gone: a superseded socket's late disconnect must
   * not have the server play a live player's turns or reap a room in use, and
   * the live socket's own disconnect must start the reconnect grace at once
   * rather than waiting out a dead socket still sitting in `sessions`.
   */
  const owners = new Map<string, string>();
  const seatKey = (roomId: string, token: string): string => `${roomId}:${token}`;

  /** Seat this socket, taking the seat over from any socket that held it before. */
  function claim(socketId: string, roomId: string, token: string): void {
    const prior = sessions.get(socketId);
    if (prior && (prior.roomId !== roomId || prior.token !== token)) release(socketId);
    sessions.set(socketId, { roomId, token });
    owners.set(seatKey(roomId, token), socketId);
  }

  /**
   * Forget this socket's seat, returning it only if the socket was still the
   * seat's owner — the only case in which its going away says anything about the
   * player.
   */
  function unseat(socketId: string): Session | null {
    const session = sessions.get(socketId);
    sessions.delete(socketId);
    if (!session) return null;
    const key = seatKey(session.roomId, session.token);
    if (owners.get(key) !== socketId) return null;
    owners.delete(key);
    return session;
  }

  /** Unseat this socket, marking its seat disconnected only if it still owned it. */
  function release(socketId: string): void {
    const session = unseat(socketId);
    if (!session) return;
    const room = manager.get(session.roomId);
    const player = room?.seatOf(session.token);
    if (!room || !player) return;
    room.setConnected(player.seat, false);
    broadcastRoom(room);
  }

  io.on("connection", (socket: HfSocket) => {
    socket.on("createRoom", (payload, ack) => {
      const room = wire(manager.create(configFor(payload.options)));
      const joined = room.join(payload.name);
      /* v8 ignore next -- a room created one statement ago cannot be full or started */
      if (!joined.ok) return ack({ ok: false, error: joined.error });
      claim(socket.id, room.id, joined.value.token);
      const credentials: SeatCredentials = {
        roomId: room.id,
        seat: joined.value.seat,
        token: joined.value.token,
      };
      ack({ ok: true, data: credentials });
      broadcastRoom(room);
    });

    socket.on("joinRoom", (payload, ack) => {
      const joined = manager.join(payload.roomId, payload.name);
      if (!joined.ok) return ack({ ok: false, error: joined.error });
      const { room, seat, token } = joined.value;
      wire(room);
      claim(socket.id, room.id, token);
      ack({ ok: true, data: { roomId: room.id, seat, token } });
      broadcastRoom(room);
    });

    socket.on("resumeSeat", (payload, ack) => {
      const room = manager.get(payload.roomId);
      if (!room) return ack({ ok: false, error: "no room with that code" });
      wire(room);
      const resumed = room.resume(payload.token);
      if (!resumed.ok) return ack({ ok: false, error: resumed.error });
      // The seat comes from the token, not from the payload's seat field: trusting
      // the field would let anyone with a valid token claim any seat in the room.
      claim(socket.id, room.id, resumed.value.token);
      ack({
        ok: true,
        data: { roomId: room.id, seat: resumed.value.seat, token: resumed.value.token },
      });
      broadcastRoom(room);
      const update = room.viewFor(resumed.value.seat);
      if (update) socket.emit("view", update);
      // The result is broadcast once, when the round ends, so a seat that comes back
      // afterwards would otherwise see a finished table with no scores on it.
      const result = room.result();
      if (result) socket.emit("roundEnded", result);
    });

    socket.on("startGame", (ack) => {
      const session = sessionOf(socket);
      if (!session) return ack({ ok: false, error: "you are not seated in a room" });
      const started = session.room.start(session.seat);
      if (!started.ok) return ack({ ok: false, error: started.error });
      ack({ ok: true, data: undefined });
      broadcastRoom(session.room);
      broadcastViews(session.room);
    });

    socket.on("submitAction", (action, ack) => {
      const session = sessionOf(socket);
      if (!session) return ack({ ok: false, error: "you are not seated in a room" });
      const applied = session.room.submitAction(session.seat, action);
      ack(ackOf(applied));
      if (!applied.ok) return;
      broadcastViews(session.room);
      broadcastResult(session.room);
    });

    socket.on("stageMelds", (payload, ack) => {
      const session = sessionOf(socket);
      if (!session) return ack({ ok: false, error: "you are not seated in a room" });
      // Normalized rather than trusted: this arrives as untyped JSON, and a draft
      // that is not a list of groups is simply no draft.
      const melds = Array.isArray(payload?.melds) ? payload.melds : [];
      ack(ackOf(session.room.stageMelds(session.seat, melds)));
    });

    socket.on("setPaused", (payload, ack) => {
      const session = sessionOf(socket);
      if (!session) return ack({ ok: false, error: "you are not seated in a room" });
      const paused = session.room.setPaused(session.seat, payload.paused);
      ack(ackOf(paused));
      if (!paused.ok) return;
      broadcastRoom(session.room);
      broadcastViews(session.room);
    });

    socket.on("playAgain", (ack) => {
      const session = sessions.get(socket.id);
      const room = session && manager.get(session.roomId);
      const player = session && room?.seatOf(session.token);
      if (!session || !room || !player) {
        return ack({ ok: false, error: "you are not seated in a room" });
      }
      if (!room.gameState?.roundEnded)
        return ack({ ok: false, error: "the round is not over yet" });

      // Everyone after the first goes to the same waiting room — unless it has been
      // dealt without them, or reaped, in which case a player who asks now gets a
      // fresh one, or is told why not.
      let next = room.nextRoomId === null ? undefined : manager.get(room.nextRoomId);
      if (next?.started) {
        return ack({ ok: false, error: "the next game has already started without you" });
      }
      if (!next) {
        next = wire(manager.create(room.config));
        room.nextRoomId = next.id;
      }
      const joined = next.join(player.name);
      if (!joined.ok) return ack({ ok: false, error: joined.error });

      // Off the old table, as a leave: this socket no longer speaks for that seat.
      unseat(socket.id);
      for (const [socketId, other] of sessions) {
        if (other.roomId === room.id && other.token === session.token) sessions.delete(socketId);
      }
      room.moveOn(session.token);
      claim(socket.id, next.id, joined.value.token);
      ack({
        ok: true,
        data: { roomId: next.id, seat: joined.value.seat, token: joined.value.token },
      });
      broadcastRoom(room);
      broadcastRoom(next);
    });

    socket.on("leaveRoom", (ack) => {
      // Only the seat's current owner speaks for it: a socket superseded by a
      // resume elsewhere must not be able to give away a seat still in use.
      const session = unseat(socket.id);
      if (!session) return ack({ ok: false, error: "you are not seated in a room" });
      const room = manager.get(session.roomId);
      /* v8 ignore next -- a room with a live owner is never abandoned, so never reaped */
      if (!room) return ack({ ok: false, error: "you are not seated in a room" });
      // Where everyone else sits now, so the ones who move up can be told.
      const before = new Map(room.seats().map((p) => [p.token, p.seat]));
      const left = room.leave(session.token);
      /* v8 ignore next -- an owned token is always still seated: only its owner can leave */
      if (!left.ok) return ack({ ok: false, error: left.error });
      // A superseded socket still holding this token has nothing left to speak for.
      for (const [socketId, other] of sessions) {
        if (other.roomId === room.id && other.token === session.token) sessions.delete(socketId);
      }
      ack({ ok: true, data: undefined });
      for (const [socketId, other] of sessions) {
        if (other.roomId !== room.id) continue;
        const player = room.seatOf(other.token);
        if (player && player.seat !== before.get(other.token)) {
          io.to(socketId).emit("seat", player.seat);
        }
      }
      broadcastRoom(room);
      broadcastViews(room);
    });

    socket.on("disconnect", () => release(socket.id));
  });
}
