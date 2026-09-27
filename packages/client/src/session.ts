/**
 * Everything the client knows about the table it is sitting at.
 *
 * The store holds state and plain setters and knows nothing about sockets; the
 * wiring lives in `attachSession` below. Keeping them apart means the reducers
 * can be asserted without a transport and the routing can be asserted without a
 * browser, which is the same split that makes the server's `Room` testable
 * without Socket.io.
 *
 * The server is authoritative, so nothing here is applied optimistically: state
 * changes when a `ViewUpdate` says it has. The one thing the client owns is the
 * clock offset, because only it knows what its own clock reads.
 */
import { create } from "zustand";
import type { RoomInfo, RoundEnded, SeatCredentials, ViewUpdate } from "@hf/shared";
import { clearCredentials, saveCredentials } from "./credentials";
import { createServerClock, type ServerClock } from "./serverTime";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface SessionState {
  status: ConnectionStatus;
  /** Null until this browser has joined a seat, or after it leaves one. */
  credentials: SeatCredentials | null;
  /** Lobby-level facts. Arrives before the game starts, unlike `update`. */
  room: RoomInfo | null;
  /** The latest per-seat update. Null until the game starts. */
  update: ViewUpdate | null;
  /** Set once a round finishes, and cleared when a new one is dealt. */
  result: RoundEnded | null;
  /** The last rejection the server sent back, for the UI to surface. */
  notice: string | null;
  readonly clock: ServerClock;

  setStatus(status: ConnectionStatus): void;
  /** Remember a seat, persisting it so a reload can reclaim it. */
  seat(credentials: SeatCredentials): void;
  /** Forget the seat and everything about the table. */
  leave(): void;
  applyRoom(room: RoomInfo): void;
  applyUpdate(update: ViewUpdate): void;
  applyResult(result: RoundEnded): void;
  setNotice(notice: string | null): void;
}

export const useSession = create<SessionState>((set, get) => ({
  status: "connecting",
  credentials: null,
  room: null,
  update: null,
  result: null,
  notice: null,
  clock: createServerClock(),

  setStatus: (status) => set({ status }),

  seat: (credentials) => {
    saveCredentials(credentials);
    set({ credentials });
  },

  leave: () => {
    clearCredentials();
    set({ credentials: null, room: null, update: null, result: null, notice: null });
  },

  applyRoom: (room) => set({ room }),

  applyUpdate: (update) => {
    // Anchor before storing, so the first render of a deadline already has an
    // offset to read it through.
    get().clock.anchor(update.clock.serverNow);
    // A `ViewUpdate` carries the room too, and it is at least as fresh as any
    // standalone `room` event, so it wins.
    set({
      update,
      room: update.room,
      // A fresh deal ends the previous round's scoreboard.
      result: update.view.roundNumber !== get().update?.view.roundNumber ? null : get().result,
    });
  },

  applyResult: (result) => set({ result }),

  setNotice: (notice) => set({ notice }),
}));

/**
 * Just the socket surface the wiring needs, so tests need no real transport.
 *
 * `off` is declared per event rather than as `(event: string, …)`: socket.io's own
 * `off` only accepts event names it knows about, so a wider signature here would
 * make the real socket fail to satisfy this interface.
 */
export interface SessionSocket {
  on(event: "connect" | "disconnect", handler: () => void): void;
  on(event: "view", handler: (update: ViewUpdate) => void): void;
  on(event: "room", handler: (info: RoomInfo) => void): void;
  on(event: "roundEnded", handler: (result: RoundEnded) => void): void;
  off(event: "connect" | "disconnect", handler: () => void): void;
  off(event: "view", handler: (update: ViewUpdate) => void): void;
  off(event: "room", handler: (info: RoomInfo) => void): void;
  off(event: "roundEnded", handler: (result: RoundEnded) => void): void;
}

/** The subset of the store the wiring writes to. */
export type SessionSink = Pick<
  SessionState,
  "setStatus" | "applyRoom" | "applyUpdate" | "applyResult"
>;

/**
 * Route the server's broadcasts into the store.
 *
 * Returns a teardown, because React will attach this more than once — a remount
 * in development, a reconnect in production — and listeners left behind would
 * apply every update twice.
 */
export function attachSession(socket: SessionSocket, sink: SessionSink): () => void {
  const onConnect = (): void => sink.setStatus("connected");
  const onDisconnect = (): void => sink.setStatus("disconnected");
  const onView = (update: ViewUpdate): void => sink.applyUpdate(update);
  const onRoom = (info: RoomInfo): void => sink.applyRoom(info);
  const onResult = (result: RoundEnded): void => sink.applyResult(result);

  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("view", onView);
  socket.on("room", onRoom);
  socket.on("roundEnded", onResult);

  return () => {
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("view", onView);
    socket.off("room", onRoom);
    socket.off("roundEnded", onResult);
  };
}
