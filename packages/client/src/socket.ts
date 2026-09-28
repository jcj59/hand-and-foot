/**
 * The typed socket, and request helpers that turn ack callbacks into promises.
 *
 * `ClientToServerEvents` and `ServerToClientEvents` come from `@hf/shared`, so
 * the compiler checks both ends of every message against one definition: a
 * change to the contract breaks whichever side is now inconsistent instead of
 * failing at runtime.
 */
import { io, type Socket } from "socket.io-client";
import type {
  Ack,
  Action,
  ClientToServerEvents,
  MeldPlay,
  RoomOptions,
  SeatCredentials,
  ServerToClientEvents,
} from "@hf/shared";

export type HfClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * How long to wait for an ack before giving up on it.
 *
 * Generous, because the server acks from an in-memory reducer and anything
 * slower than this is a broken connection rather than a busy table.
 */
export const ACK_TIMEOUT_MS = 10_000;

/**
 * What a request that was never answered resolves to.
 *
 * Exported so a caller can tell "the server said no" from "the server said
 * nothing": a refused seat is gone, but an unanswered request says only that the
 * connection is bad, and treating the two alike would throw a player out of a
 * game over a slow network.
 */
export const NO_RESPONSE = "the server did not respond — check your connection";

/**
 * Where the server lives.
 *
 * Separate origins in development on purpose: production serves the client from
 * Vercel and the server from Fly.io, so running them apart locally exercises the
 * CORS configuration rather than leaving it to be discovered on deploy.
 */
export function serverUrl(env: { readonly VITE_SERVER_URL?: string } = import.meta.env): string {
  return env.VITE_SERVER_URL ?? "http://localhost:3000";
}

/**
 * The URL is required rather than defaulted, so the one place that decides where
 * this client connects is the entry point, in plain sight.
 */
export function connect(url: string): HfClientSocket {
  // Socket.io reconnects on its own; the seat is reclaimed separately with the
  // stored credentials, because a new transport connection is a new socket as
  // far as the server is concerned and carries no seat with it.
  return io(url, { transports: ["websocket"], autoConnect: true });
}

/**
 * Await one request/ack exchange.
 *
 * A timeout resolves to a rejection rather than throwing, so callers handle one
 * shape: the protocol already models a refused move as `{ ok: false, error }`
 * rather than an exception, and a UI that had to catch for "unreachable" and
 * branch for "illegal" would duplicate every call site. The message is distinct
 * enough to tell the two apart when that matters, and the store tracks
 * connection state separately for the banner.
 */
export function ask<T>(
  emit: (ack: (result: Ack<T>) => void) => void,
  timeoutMs: number = ACK_TIMEOUT_MS,
  setTimer: typeof setTimeout = setTimeout,
  clearTimer: typeof clearTimeout = clearTimeout,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timer = setTimer(() => resolve({ ok: false, error: NO_RESPONSE }), timeoutMs);
    emit((result) => {
      // Cancelling matters: an armed timer would fire against an already-settled
      // promise and, in a browser, hold a wakeup for the full timeout after every
      // request. Whichever of the two arrives first wins on its own — resolving a
      // settled promise is a no-op — so a late ack needs no flag to guard it.
      clearTimer(timer);
      resolve(result);
    });
  });
}

export function createRoom(
  socket: HfClientSocket,
  name: string,
  options?: RoomOptions,
): Promise<Ack<SeatCredentials>> {
  return ask((ack) => socket.emit("createRoom", { name, options }, ack));
}

export function joinRoom(
  socket: HfClientSocket,
  roomId: string,
  name: string,
): Promise<Ack<SeatCredentials>> {
  return ask((ack) => socket.emit("joinRoom", { roomId, name }, ack));
}

/** Reclaim a seat with the token issued on join, after a reload or a dropped socket. */
export function resumeSeat(
  socket: HfClientSocket,
  credentials: SeatCredentials,
): Promise<Ack<SeatCredentials>> {
  return ask((ack) => socket.emit("resumeSeat", credentials, ack));
}

/** Give up the seat this socket holds. */
export function leaveRoom(socket: HfClientSocket): Promise<Ack<undefined>> {
  return ask((ack) => socket.emit("leaveRoom", ack));
}

export function startGame(socket: HfClientSocket): Promise<Ack<undefined>> {
  return ask((ack) => socket.emit("startGame", ack));
}

export function submitAction(socket: HfClientSocket, action: Action): Promise<Ack<undefined>> {
  return ask((ack) => socket.emit("submitAction", action, ack));
}

export function playAgain(socket: HfClientSocket): Promise<Ack<SeatCredentials>> {
  return ask((ack) => socket.emit("playAgain", ack));
}

export function stageMelds(
  socket: HfClientSocket,
  melds: readonly MeldPlay[],
): Promise<Ack<undefined>> {
  return ask((ack) => socket.emit("stageMelds", { melds }, ack));
}

export function setPaused(socket: HfClientSocket, paused: boolean): Promise<Ack<undefined>> {
  return ask((ack) => socket.emit("setPaused", { paused }, ack));
}
