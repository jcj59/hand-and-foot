/**
 * Starting and stopping the process.
 *
 * `createServer` deliberately builds a server without starting it, so that the
 * tests can drive one on an ephemeral port. That leaves somebody to read the
 * environment, bind the port and take the thing down again, which is this
 * module. The pieces that touch the outside world — the log and the signals —
 * are injected rather than reached for, on the same reasoning as `Clock`: a
 * bootstrap that writes to the real `console` and installs handlers on the real
 * `process` cannot be tested without leaking both across the suite.
 */
import { fileURLToPath } from "node:url";
import { parseServerEnv, type Environment } from "./env";
import { createServer, type HandAndFootServer } from "./index";
import { openPostgresStore } from "./postgres";
import type { RoomStore, StoredRoom } from "./store";

/** Just enough of `console` to report through. */
export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

/** Just enough of `process` to hear a shutdown request. */
export interface SignalSource {
  once(signal: "SIGTERM" | "SIGINT", handler: () => void): void;
}

export interface Started {
  readonly server: HandAndFootServer;
  readonly port: number;
}

/** Connects to the database named by `DATABASE_URL`. Injected so the suite need not have one. */
export type OpenStore = (url: string, logger: Logger) => Promise<RoomStore>;

const openPostgres: OpenStore = (url, logger) => openPostgresStore(url, { logger });

/** The signals a host uses to stop a server: Fly sends the first, Ctrl-C the second. */
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/**
 * Boot from the environment, resolving once the port is accepting players.
 *
 * Returns null when the environment is unusable, having already said why. The
 * caller is the process itself, and the only sensible response to configuration
 * it cannot parse is to stop with a non-zero status rather than to start on
 * settings nobody asked for.
 *
 * A database that is configured but cannot be reached is the same case. Starting
 * anyway would run tables that the next deploy silently throws away, which is the
 * one thing configuring a database was meant to prevent; stopping lets the host
 * retry the boot until it is back.
 *
 * Rooms are restored before the port opens, so no player can reach a table that
 * is still being rebuilt.
 */
export async function startFromEnv(
  env: Environment,
  logger: Logger = console,
  openStore: OpenStore = openPostgres,
): Promise<Started | null> {
  const parsed = parseServerEnv(env);
  if (!parsed.ok) {
    logger.error(`invalid server configuration: ${parsed.error}`);
    return null;
  }

  const { port: requested, options, databaseUrl } = parsed.value;
  let store: RoomStore | undefined;
  let stored: readonly StoredRoom[] = [];
  if (databaseUrl !== undefined) {
    try {
      store = await openStore(databaseUrl, logger);
    } catch (error) {
      // The driver's message names the host and the failure, never the password.
      logger.error(`could not open the database: ${messageOf(error)}`);
      return null;
    }
    try {
      stored = await store.loadOpen();
    } catch (error) {
      logger.error(`could not load rooms from the database: ${messageOf(error)}`);
      await store.close();
      return null;
    }
  }

  const server = createServer({ ...options, store });
  // Said on the startup line either way: a server quietly keeping its tables in
  // memory is the misconfiguration most worth noticing on the first deploy.
  let rooms = "rooms: in memory only, lost on restart";
  if (store) {
    const failures = server.manager.restore(stored);
    for (const failure of failures) logger.error(`could not restore ${failure.error}`);
    rooms = `rooms: in the database, ${stored.length - failures.length} of ${stored.length} restored`;
  }
  const port = await server.listen(requested);
  const origins = options.cors;
  logger.log(
    `hand-and-foot server listening on :${port} (origins: ${origins ? origins.join(", ") : "any"}; ${rooms})`,
  );
  return { server, port };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Close the rooms down when the host asks the process to stop, writing out
 * whatever the store still has queued.
 *
 * This is not just politeness. `close` runs `disposeAll`, and every room holds a
 * live turn-clock timer; a process torn down without releasing them is the same
 * runaway the abandoned-room reaper exists to prevent, only now with no reaper
 * left running. The timers are unref'd, so once the sockets are closed the event
 * loop empties and the process exits on its own — there is nothing to force.
 *
 * Each signal is handled `once`: a second SIGTERM arriving during a shutdown
 * already in flight should not begin a second one.
 */
export function shutdownOnSignals(
  started: Started,
  source: SignalSource = process,
  logger: Logger = console,
): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    source.once(signal, () => {
      logger.log(`${signal} received, closing rooms`);
      void started.server.close();
    });
  }
}

/**
 * Run as the process when this module is the one node was pointed at, and stay
 * inert when a test imports it. Everything above is exercised by the suite; this
 * is the one part that can only be checked by actually starting the server,
 * which `pnpm --filter @hf/server start` does.
 */
/* v8 ignore start -- being the process is the one thing the suite cannot be */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const started = await startFromEnv(process.env);
  if (started === null) process.exit(1);
  shutdownOnSignals(started);
}
/* v8 ignore stop */
