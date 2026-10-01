import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { type Clock, systemClock } from "./clock";
import { RoomManager } from "./manager";
import { attachTables, type Tables } from "./socket";
import type { RoomStore } from "./store";
import type { UserStore } from "./users";

export * from "./clock";
export * from "./lobby";
export * from "./log";
export * from "./manager";
export * from "./postgres";
export * from "./room";
export * from "./socket";
export * from "./store";
export * from "./table";
export * from "./users";

export interface ServerOptions {
  readonly clock?: Clock;
  readonly random?: () => number;
  /** Grace a dropped player gets before the server starts playing their turns. */
  readonly reconnectGraceMs?: number;
  /** How long a room with nobody in it is kept before being reaped. */
  readonly abandonedRoomMs?: number;
  /** Allowed browser origins. The client is served from a different host in production. */
  readonly cors?: readonly string[];
  /** How often each socket is checked for a vanished client; see `TransportOptions`. */
  readonly heartbeatMs?: number;
  /**
   * Where rooms are kept so a restart can bring them back. The server takes it
   * over: `close` flushes and closes it. Restoring what it already holds is the
   * caller's move, through `manager.restore`, since only the caller knows whether
   * this is a fresh boot.
   */
  readonly store?: RoomStore;
  /** Where identities are kept; the store's own when it keeps them, else in memory. */
  readonly users?: UserStore;
}

export interface HandAndFootServer {
  readonly http: HttpServer;
  readonly manager: RoomManager;
  /** Each table's connections, for tests and for the transport. */
  readonly tables: Tables;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Build the authoritative server without starting it, so tests can drive it on
 * an ephemeral port and shut it down cleanly.
 */
export function createServer(options: ServerOptions = {}): HandAndFootServer {
  const http = createHttpServer();
  const manager = new RoomManager({
    clock: options.clock ?? systemClock,
    random: options.random,
    reconnectGraceMs: options.reconnectGraceMs,
    abandonedRoomMs: options.abandonedRoomMs,
    store: options.store,
  });
  const tables = attachTables(http, manager, {
    cors: options.cors,
    heartbeatMs: options.heartbeatMs,
    users: options.users ?? options.store?.users?.(),
    now: () => (options.clock ?? systemClock).now(),
  });
  manager.startSweeping();

  return {
    http,
    manager,
    tables,
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
      tables.close();
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
      // Last, so the final moves before shutdown are written: they are exactly
      // the ones the restart needs.
      await options.store?.close();
    },
  };
}
