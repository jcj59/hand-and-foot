import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { type Clock, systemClock } from "./clock";
import { RoomManager } from "./manager";
import { attachSocketServer, type HfServer } from "./socket";

export * from "./clock";
export * from "./log";
export * from "./manager";
export * from "./room";
export * from "./socket";

export interface ServerOptions {
  readonly clock?: Clock;
  readonly random?: () => number;
  /** Grace a dropped player gets before the server starts playing their turns. */
  readonly reconnectGraceMs?: number;
  /** How long a room with nobody in it is kept before being reaped. */
  readonly abandonedRoomMs?: number;
  /** Allowed browser origins. The client is served from a different host in production. */
  readonly cors?: readonly string[];
}

export interface HandAndFootServer {
  readonly http: HttpServer;
  readonly io: HfServer;
  readonly manager: RoomManager;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Build the authoritative server without starting it, so tests can drive it on
 * an ephemeral port and shut it down cleanly.
 */
export function createServer(options: ServerOptions = {}): HandAndFootServer {
  const http = createHttpServer();
  const io: HfServer = new Server(http, {
    cors: { origin: options.cors ? [...options.cors] : "*" },
  });
  const manager = new RoomManager({
    clock: options.clock ?? systemClock,
    random: options.random,
    reconnectGraceMs: options.reconnectGraceMs,
    abandonedRoomMs: options.abandonedRoomMs,
  });
  attachSocketServer(io, manager);
  manager.startSweeping();

  return {
    http,
    io,
    manager,
    listen(port) {
      return new Promise((resolve) => {
        http.listen(port, () => {
          const address = http.address();
          // Port 0 asks the OS for a free port; the caller needs to learn which.
          // The non-object form is a unix socket path, which this server never
          // listens on, so the requested port is the only sensible fallback.
          /* v8 ignore next */
          resolve(typeof address === "object" && address !== null ? address.port : port);
        });
      });
    },
    close() {
      // Rooms hold live timers; dropping the server without releasing them would
      // keep firing turn clocks for tables that no longer exist.
      manager.disposeAll();
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}
