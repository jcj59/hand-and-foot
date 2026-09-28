import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { type Clock, systemClock } from "./clock";
import { RoomManager } from "./manager";
import { attachSocketServer, type HfServer } from "./socket";
import type { RoomStore } from "./store";

export * from "./clock";
export * from "./log";
export * from "./manager";
export * from "./postgres";
export * from "./room";
export * from "./socket";
export * from "./store";

export interface ServerOptions {
  readonly clock?: Clock;
  readonly random?: () => number;
  /** Grace a dropped player gets before the server starts playing their turns. */
  readonly reconnectGraceMs?: number;
  /** How long a room with nobody in it is kept before being reaped. */
  readonly abandonedRoomMs?: number;
  /** Allowed browser origins. The client is served from a different host in production. */
  readonly cors?: readonly string[];
  /**
   * Where rooms are kept so a restart can bring them back. The server takes it
   * over: `close` flushes and closes it. Restoring what it already holds is the
   * caller's move, through `manager.restore`, since only the caller knows whether
   * this is a fresh boot.
   */
  readonly store?: RoomStore;
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
  // Socket.io answers its own path and hands every other request to this. The one
  // other thing worth answering is whether the process is up, for the host's
  // health check; a bare 200 is what Fly needs, and the room count is a cheap
  // sign of life when reading it by hand.
  const http = createHttpServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, rooms: manager.size }));
      return;
    }
    response.writeHead(404).end();
  });
  const io: HfServer = new Server(http, {
    cors: { origin: options.cors ? [...options.cors] : "*" },
  });
  const manager = new RoomManager({
    clock: options.clock ?? systemClock,
    random: options.random,
    reconnectGraceMs: options.reconnectGraceMs,
    abandonedRoomMs: options.abandonedRoomMs,
    store: options.store,
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
    async close() {
      // Rooms hold live timers; dropping the server without releasing them would
      // keep firing turn clocks for tables that no longer exist.
      manager.disposeAll();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      // Last, so the final moves before shutdown are written: they are exactly
      // the ones the restart needs.
      await options.store?.close();
    },
  };
}
