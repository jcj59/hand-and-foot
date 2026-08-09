import type { Server, Socket } from "socket.io";
import type { Ack, ClientToServerEvents, SeatCredentials, ServerToClientEvents } from "@hf/shared";
import type { RoomManager } from "./manager";
import type { Room, RoomResult } from "./room";

export type HfServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type HfSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Which seat in which room a connected socket is holding. */
interface Session {
  readonly roomId: string;
  readonly seat: number;
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
      const update = room.viewFor(session.seat);
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

  /** The room this socket is seated in, with its seat, or null if it has none. */
  function sessionOf(socket: HfSocket): { room: Room; seat: number } | null {
    const session = sessions.get(socket.id);
    if (!session) return null;
    const room = manager.get(session.roomId);
    if (!room) return null;
    return { room, seat: session.seat };
  }

  io.on("connection", (socket: HfSocket) => {
    socket.on("createRoom", (payload, ack) => {
      const room = manager.create();
      const joined = room.join(payload.name);
      /* v8 ignore next -- a room created one statement ago cannot be full or started */
      if (!joined.ok) return ack({ ok: false, error: joined.error });
      sessions.set(socket.id, { roomId: room.id, seat: joined.value.seat });
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
      sessions.set(socket.id, { roomId: room.id, seat });
      ack({ ok: true, data: { roomId: room.id, seat, token } });
      broadcastRoom(room);
    });

    socket.on("resumeSeat", (payload, ack) => {
      const room = manager.get(payload.roomId);
      if (!room) return ack({ ok: false, error: "no room with that code" });
      const resumed = room.resume(payload.token);
      if (!resumed.ok) return ack({ ok: false, error: resumed.error });
      // The seat comes from the token, not from the payload's seat field: trusting
      // the field would let anyone with a valid token claim any seat in the room.
      sessions.set(socket.id, { roomId: room.id, seat: resumed.value.seat });
      ack({ ok: true, data: undefined });
      broadcastRoom(room);
      const update = room.viewFor(resumed.value.seat);
      if (update) socket.emit("view", update);
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

    socket.on("setPaused", (payload, ack) => {
      const session = sessionOf(socket);
      if (!session) return ack({ ok: false, error: "you are not seated in a room" });
      const paused = session.room.setPaused(session.seat, payload.paused);
      ack(ackOf(paused));
      if (!paused.ok) return;
      broadcastRoom(session.room);
      broadcastViews(session.room);
    });

    socket.on("disconnect", () => {
      const session = sessionOf(socket);
      sessions.delete(socket.id);
      if (!session) return;
      session.room.setConnected(session.seat, false);
      broadcastRoom(session.room);
    });
  });
}
