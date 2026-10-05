import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { InMemoryRoomStore } from "./store";
import { ownDatabase } from "./testDatabase";
import {
  shutdownOnSignals,
  startFromEnv,
  type Logger,
  type OpenStore,
  type SignalSource,
  type Started,
} from "./main";

/** Captures what the bootstrap would have written to the console. */
function recorder(): Logger & { readonly logs: string[]; readonly errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };
}

/**
 * A stand-in for `process` that lets a test fire a signal by hand. Installing
 * handlers on the real process would leak them into every later test in the file.
 */
interface FakeSignals extends SignalSource {
  fire(signal: "SIGTERM" | "SIGINT"): void;
  readonly heard: readonly string[];
}

function signals(): FakeSignals {
  const handlers = new Map<string, () => void>();
  const heard: string[] = [];
  return {
    heard,
    once(signal, handler) {
      heard.push(signal);
      handlers.set(signal, handler);
    },
    // Faithful to `process.once`: the handler is dropped after it runs, so a
    // repeat of the same signal cannot re-enter it.
    fire(signal) {
      const handler = handlers.get(signal);
      handlers.delete(signal);
      handler?.();
    },
  };
}

/** Start a real server on an ephemeral port, asserting it came up. */
async function start(env: Record<string, string | undefined> = {}): Promise<Started> {
  const started = await startFromEnv({ PORT: "0", ...env }, recorder());
  if (started === null) throw new Error("expected the server to start");
  return started;
}

/** Wait for the fire-and-forget shutdown to actually let go of the port. */
async function untilClosed(started: Started): Promise<void> {
  for (let i = 0; i < 100 && started.server.http.listening; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("startFromEnv", () => {
  it("binds the port and reports the one actually assigned", async () => {
    // Port 0 asks the OS for a free one, so the log line has to name the result
    // rather than the request — otherwise it tells the operator nothing useful.
    const log = recorder();
    const started = await startFromEnv({ PORT: "0" }, log);
    expect(started).not.toBeNull();
    expect(started!.port).toBeGreaterThan(0);
    expect(started!.server.http.listening).toBe(true);
    expect(log.logs).toEqual([
      `hand-and-foot server listening on :${started!.port} (origins: any; rooms: in memory only, lost on restart)`,
    ]);
    expect(log.errors).toEqual([]);
    await started!.server.close();
  });

  it("starts with no rooms", async () => {
    const started = await start();
    expect(started.server.manager.size).toBe(0);
    await started.server.close();
  });

  it("passes the parsed origins through to the socket server", async () => {
    // Parsing them and then dropping them would leave production wide open.
    const log = recorder();
    const started = await startFromEnv(
      { PORT: "0", HF_CORS_ORIGINS: "https://handandfoot.example" },
      log,
    );
    const refused = await fetch(`http://localhost:${started!.port}/api/rooms`, {
      method: "POST",
      headers: { origin: "https://elsewhere.example" },
      body: "{}",
    });
    expect(refused.status).toBe(403);
    expect(log.logs[0]).toContain("origins: https://handandfoot.example");
    await started!.server.close();
  });

  it("names every allowed origin in the startup line", async () => {
    const log = recorder();
    const started = await startFromEnv(
      { PORT: "0", HF_CORS_ORIGINS: "http://localhost:5173,http://localhost:4173" },
      log,
    );
    expect(log.logs[0]).toContain("origins: http://localhost:5173, http://localhost:4173");
    await started!.server.close();
  });

  it("refuses to start on an environment it cannot parse, and says why", async () => {
    const log = recorder();
    const started = await startFromEnv({ PORT: "808O" }, log);
    expect(started).toBeNull();
    expect(log.errors).toEqual([
      'invalid server configuration: PORT must be a whole number from 0 to 65535, not "808O"',
    ]);
    // Nothing was bound and nothing was announced: quietly starting on the
    // default port would be worse than not starting at all.
    expect(log.logs).toEqual([]);
  });

  it("reports a bad duration without starting either", async () => {
    const log = recorder();
    expect(await startFromEnv({ HF_ABANDONED_ROOM_MS: "10m" }, log)).toBeNull();
    expect(log.errors[0]).toContain("HF_ABANDONED_ROOM_MS");
  });
});

describe("shutdownOnSignals", () => {
  it("listens for both of the signals a host uses to stop a process", async () => {
    // Fly stops an instance with SIGTERM; Ctrl-C in development sends SIGINT.
    // Handling only one leaves the other killing the process with rooms' turn
    // clocks still armed.
    const started = await start();
    const source = signals();
    shutdownOnSignals(started, source, recorder());
    expect(source.heard).toEqual(["SIGTERM", "SIGINT"]);
    await started.server.close();
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "closes the server on %s, naming the signal",
    async (signal) => {
      // close() is what runs disposeAll, and a turn clock left armed against a
      // table nobody can reach is the runaway the reaper exists to prevent —
      // except that after shutdown there is no reaper left running either.
      const started = await start();
      const source = signals();
      const log = recorder();
      shutdownOnSignals(started, source, log);

      const room = started.server.manager.create();
      room.join("ana");
      room.join("ben");
      room.start(0);

      source.fire(signal);
      await untilClosed(started);
      expect(log.logs).toEqual([`${signal} received, closing rooms`]);
      expect(started.server.http.listening).toBe(false);
    },
  );

  it("survives both signals arriving, as a supervisor after a Ctrl-C would send", async () => {
    // The two signals are registered separately, so both can fire for one
    // shutdown and close() runs twice. That has to be harmless rather than an
    // unhandled rejection on the way out.
    const started = await start();
    const source = signals();
    const log = recorder();
    shutdownOnSignals(started, source, log);

    source.fire("SIGINT");
    source.fire("SIGTERM");
    await untilClosed(started);

    expect(log.logs).toEqual(["SIGINT received, closing rooms", "SIGTERM received, closing rooms"]);
    expect(started.server.http.listening).toBe(false);
  });
});

describe("startFromEnv with a database", () => {
  const URL = "postgres://hf:secret@db.example/hf";

  /** A store opener that hands back a given store and remembers what it was asked for. */
  function opener(store: InMemoryRoomStore): OpenStore & { readonly urls: string[] } {
    const urls: string[] = [];
    return Object.assign(
      async (url: string) => {
        urls.push(url);
        return store;
      },
      { urls },
    );
  }

  /** A store holding one dealt two-seat table, as a previous process would have left it. */
  async function storeWithATable(): Promise<{ store: InMemoryRoomStore; code: string }> {
    const store = new InMemoryRoomStore();
    const before = await startFromEnv({ PORT: "0", DATABASE_URL: URL }, recorder(), opener(store));
    const room = before!.server.manager.create();
    room.join("ana");
    room.join("ben");
    room.start(0);
    await before!.server.close();
    return { store, code: room.id };
  }

  it("opens the named database and brings its open rooms back before taking players", async () => {
    const { store, code } = await storeWithATable();
    const log = recorder();
    const open = opener(store);
    const started = await startFromEnv({ PORT: "0", DATABASE_URL: URL }, log, open);
    expect(open.urls).toEqual([URL]);
    expect(started!.server.manager.get(code)?.started).toBe(true);
    expect(log.logs).toEqual([
      `hand-and-foot server listening on :${started!.port} (origins: any; rooms: in the database, 1 of 1 restored)`,
    ]);
    expect(log.errors).toEqual([]);
    await started!.server.close();
  });

  it("names each room it could not bring back, and starts without it", async () => {
    const { store } = await storeWithATable();
    const [stored] = await store.loadOpen();
    const broken = new InMemoryRoomStore();
    broken.saveRoom({ ...stored!.room, started: false });
    broken.appendAction(stored!.room.uid, {
      seq: 0,
      seat: 0,
      action: { type: "draw" },
      source: "player",
      at: 0,
    });
    const log = recorder();
    const started = await startFromEnv({ PORT: "0", DATABASE_URL: URL }, log, opener(broken));
    expect(started).not.toBeNull();
    expect(started!.server.manager.size).toBe(0);
    expect(log.errors).toEqual([
      `could not restore room ${stored!.room.id}: actions recorded for a table that never dealt`,
    ]);
    expect(log.logs[0]).toContain("rooms: in the database, 0 of 1 restored");
    await started!.server.close();
  });

  it("refuses to start when the database cannot be opened, rather than run without it", async () => {
    // Running anyway would host tables the next deploy silently throws away.
    const log = recorder();
    const failing: OpenStore = async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    };
    expect(await startFromEnv({ PORT: "0", DATABASE_URL: URL }, log, failing)).toBeNull();
    expect(log.errors).toEqual(["could not open the database: connect ECONNREFUSED 10.0.0.5:5432"]);
    expect(log.logs).toEqual([]);
  });

  it("reports a failure that is not an Error as it came", async () => {
    const log = recorder();
    const failing: OpenStore = () => Promise.reject("timeout");
    expect(await startFromEnv({ PORT: "0", DATABASE_URL: URL }, log, failing)).toBeNull();
    expect(log.errors).toEqual(["could not open the database: timeout"]);
  });

  it("refuses to start when the rooms cannot be loaded, and lets go of the database", async () => {
    // Starting without them would host fresh tables over rooms the next boot restores.
    const log = recorder();
    const store = new InMemoryRoomStore();
    let closed = 0;
    store.loadOpen = () => Promise.reject(new Error('relation "rooms" does not exist'));
    store.close = async () => {
      closed++;
    };
    expect(await startFromEnv({ PORT: "0", DATABASE_URL: URL }, log, opener(store))).toBeNull();
    expect(log.errors).toEqual([
      'could not load rooms from the database: relation "rooms" does not exist',
    ]);
    expect(log.logs).toEqual([]);
    expect(closed).toBe(1);
  });

  it("does not touch a database when none is configured", async () => {
    const open = opener(new InMemoryRoomStore());
    const started = await startFromEnv({ PORT: "0" }, recorder(), open);
    expect(open.urls).toEqual([]);
    await started!.server.close();
  });
});

describe.skipIf(process.env.HF_TEST_DATABASE_URL === undefined)("startFromEnv on Postgres", () => {
  it("connects with nothing injected, keeps rooms across a restart, and says so", async () => {
    const url = await ownDatabase(process.env.HF_TEST_DATABASE_URL!, "hf_test_main");
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin`drop table if exists match_players, matches, actions, rooms, users, logins, schema_migrations`;
    await admin.end();

    const first = await startFromEnv({ PORT: "0", DATABASE_URL: url }, recorder());
    const room = first!.server.manager.create();
    room.join("ana");
    await first!.server.close();

    const log = recorder();
    const second = await startFromEnv({ PORT: "0", DATABASE_URL: url }, log);
    expect(
      second!.server.manager
        .get(room.id)
        ?.seats()
        .map((p) => p.name),
    ).toEqual(["ana"]);
    expect(log.logs[0]).toContain("rooms: in the database, 1 of 1 restored");
    await second!.server.close();
  });
});
