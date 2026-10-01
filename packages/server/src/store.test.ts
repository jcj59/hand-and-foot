/**
 * One contract for every `RoomStore`.
 *
 * The in-memory store stands in for the database in most of the suite, which is
 * only honest if the two behave the same. So the same cases run against both: the
 * in-memory one always, and Postgres whenever `HF_TEST_DATABASE_URL` names a
 * database the suite may wipe — which CI provides, and which a laptop can by
 * pointing it at any local Postgres.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  EAST_COAST,
  resolveRules,
  WEST_COAST,
  type LoggedAction,
  type RulesConfig,
} from "@hf/shared";
import { migrate, MIGRATIONS, openPostgresStore, PostgresRoomStore } from "./postgres";
import { ownDatabase } from "./testDatabase";
import { InMemoryRoomStore, type RoomRecord, type RoomStore } from "./store";

const DATABASE_URL = process.env.HF_TEST_DATABASE_URL;

function record(overrides: Partial<RoomRecord> = {}): RoomRecord {
  return {
    uid: "uid-1",
    id: "ABC234",
    config: EAST_COAST,
    seed: 2_147_483_000,
    createdAt: 1_700_000_000_123,
    players: [
      { seat: 0, name: "Ana", token: "tok-a", left: false },
      { seat: 1, name: "Bén 🂡", token: "tok-b", left: true },
    ],
    started: true,
    pausedSeat: null,
    hostToken: "tok-b",
    ...overrides,
  };
}

function row(seq: number, overrides: Partial<LoggedAction> = {}): LoggedAction {
  return {
    seq,
    seat: seq % 2,
    action: { type: "draw" },
    source: "player",
    at: 1_700_000_000_000 + seq,
    ...overrides,
  };
}

function contract(name: string, open: () => Promise<RoomStore>): void {
  describe(`${name}: the RoomStore contract`, () => {
    let store: RoomStore;
    beforeEach(async () => {
      store = await open();
    });

    it("gives back a room and its log exactly as they went in", async () => {
      const melds: LoggedAction = row(2, {
        action: {
          type: "playMelds",
          melds: [
            { rank: "K", cardIds: ["h-K-0", "s-K-1", "c-2-0"] },
            { rank: "7", cardIds: ["d-7-0"] },
          ],
        },
        source: "timeout",
      });
      store.saveRoom(record({ config: WEST_COAST, pausedSeat: 1 }));
      store.appendAction("uid-1", row(0));
      store.appendAction("uid-1", row(1, { action: { type: "takePile" }, source: "disconnect" }));
      store.appendAction("uid-1", melds);
      await store.flush();
      expect(await store.loadOpen()).toEqual([
        {
          room: record({ config: WEST_COAST, pausedSeat: 1 }),
          actions: [row(0), row(1, { action: { type: "takePile" }, source: "disconnect" }), melds],
        },
      ]);
    });

    it("gives back a table's own rules whole, and rules stored before they named a preset", async () => {
      const custom = resolveRules({
        preset: "west-coast",
        mode: "competitive",
        rules: { rounds: 2, layDownMinimums: [0, 500], scoring: { redThree: -1000 } },
      });
      if (!custom.ok) throw new Error(custom.error);
      const old = JSON.parse(JSON.stringify({ ...EAST_COAST, preset: undefined })) as RulesConfig;
      store.saveRoom(record({ config: custom.data }));
      store.saveRoom(
        record({ uid: "uid-2", id: "OLD234", config: old, createdAt: 1_700_000_000_999 }),
      );
      await store.flush();
      const loaded = await store.loadOpen();
      expect(loaded.map((r) => r.room.config)).toEqual([custom.data, old]);
      expect(loaded[1]!.room.config).not.toHaveProperty("preset");
    });

    it("gives back what the table is waiting on between rounds and after the match", async () => {
      const waiting = { nextRoundReady: ["tok-a"], wentOn: ["tok-b"], nextRoomId: "NXT234" };
      store.saveRoom(record(waiting));
      await store.flush();
      const [loaded] = await store.loadOpen();
      expect(loaded?.room).toEqual(record(waiting));
    });

    it("gives back when a pause began, whether the table paused itself, and until when it is saved", async () => {
      const paused = { pausedSeat: 1, idlePaused: true, pausedSince: 1_000, savedUntil: 9_000 };
      store.saveRoom(record(paused));
      await store.flush();
      const [loaded] = await store.loadOpen();
      expect(loaded?.room).toEqual(record(paused));
    });

    it("replaces the record on a second save, keeping the log", async () => {
      store.saveRoom(record({ started: false }));
      store.appendAction("uid-1", row(0));
      store.saveRoom(record({ players: [record().players[0]!], started: true, pausedSeat: 0 }));
      await store.flush();
      const [loaded] = await store.loadOpen();
      expect(loaded?.room.players).toHaveLength(1);
      expect(loaded?.room.started).toBe(true);
      expect(loaded?.room.pausedSeat).toBe(0);
      expect(loaded?.actions).toEqual([row(0)]);
    });

    it("records an action once however many times it is written", async () => {
      // A retry after a write that landed but lost its reply.
      store.saveRoom(record());
      store.appendAction("uid-1", row(0));
      store.appendAction("uid-1", row(0));
      await store.flush();
      expect((await store.loadOpen())[0]?.actions).toEqual([row(0)]);
    });

    it("returns each room's log oldest first", async () => {
      store.saveRoom(record());
      for (const seq of [0, 1, 2, 3, 4]) store.appendAction("uid-1", row(seq));
      await store.flush();
      expect((await store.loadOpen())[0]?.actions.map((a) => a.seq)).toEqual([0, 1, 2, 3, 4]);
    });

    it("leaves closed rooms out, without touching the others", async () => {
      store.saveRoom(record());
      store.saveRoom(record({ uid: "uid-2", id: "XYZ789" }));
      store.appendAction("uid-2", row(0));
      store.closeRoom("uid-1", 1_700_000_100_000);
      await store.flush();
      const open = await store.loadOpen();
      expect(open.map((r) => r.room.uid)).toEqual(["uid-2"]);
      expect(open[0]?.actions).toEqual([row(0)]);
    });

    it("lets a closed room's code be used again without the new table inheriting its log", async () => {
      store.saveRoom(record());
      store.appendAction("uid-1", row(0));
      store.closeRoom("uid-1", 1_700_000_100_000);
      store.saveRoom(record({ uid: "uid-2", started: false }));
      await store.flush();
      expect(await store.loadOpen()).toEqual([
        { room: record({ uid: "uid-2", started: false }), actions: [] },
      ]);
    });

    it("keeps a closed room closed when its record is saved again", async () => {
      // A last write racing the reaper must not reopen a room let go on purpose.
      store.saveRoom(record());
      store.closeRoom("uid-1", 1_700_000_100_000);
      store.saveRoom(record({ pausedSeat: 1 }));
      await store.flush();
      expect(await store.loadOpen()).toEqual([]);
    });

    it("starts empty", async () => {
      expect(await store.loadOpen()).toEqual([]);
    });
  });
}

contract("in memory", async () => new InMemoryRoomStore());

describe.skipIf(DATABASE_URL === undefined)("Postgres", () => {
  let url = "";
  let admin: postgres.Sql;
  const opened: PostgresRoomStore[] = [];

  beforeAll(async () => {
    url = await ownDatabase(DATABASE_URL!, "hf_test_store");
    admin = postgres(url, { max: 1, onnotice: () => {} });
  });

  async function wipe(): Promise<void> {
    await admin`drop table if exists actions, rooms, users, schema_migrations`;
  }

  async function fresh(): Promise<PostgresRoomStore> {
    await wipe();
    const store = await openPostgresStore(url, { retryDelaysMs: [] });
    opened.push(store);
    return store;
  }

  afterAll(async () => {
    for (const store of opened) await store.close();
    await wipe();
    await admin.end();
  });

  contract("postgres", fresh);

  describe("migrations", () => {
    it("apply once, and a second boot finds nothing to do", async () => {
      await wipe();
      expect(await migrate(admin)).toBe(4);
      expect(await migrate(admin)).toBe(0);
      const versions = await admin`select version from schema_migrations order by version`;
      expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4]);
    });

    it("are safe for two servers booting at once", async () => {
      await wipe();
      const second = postgres(url, { max: 1, onnotice: () => {} });
      try {
        const [a, b] = await Promise.all([migrate(admin), migrate(second)]);
        expect(a + b).toBe(4);
      } finally {
        await second.end();
      }
    });
  });

  it("upgrades a database made before a later migration, and keeps its rows", async () => {
    // A server that ran only the first migration, then a newer one boots.
    await wipe();
    await admin`create table schema_migrations (version integer primary key, applied_at timestamptz not null default now())`;
    await admin.unsafe(MIGRATIONS[0]!);
    await admin`insert into schema_migrations (version) values (1)`;
    await admin`insert into rooms (uid, code, config, seed, created_at, players, started)
      values ('old', 'OLD234', ${admin.json(EAST_COAST as never)}, 1, 1, '[]', false)`;
    expect(await migrate(admin)).toBe(3);
    const store = new PostgresRoomStore(admin, { retryDelaysMs: [] });
    const [old] = await store.loadOpen();
    expect(old?.room.uid).toBe("old");
    // A room saved before hosting could move records no host.
    expect(old?.room.hostToken).toBeNull();
    // Nor anything it was waiting on.
    expect(old?.room.nextRoundReady).toBeUndefined();
    expect(old?.room.nextRoomId).toBeUndefined();
  });

  it("keeps a closed room's rows: a finished game is a record, not garbage", async () => {
    const store = await fresh();
    store.saveRoom(record());
    store.appendAction("uid-1", row(0));
    store.closeRoom("uid-1", 1_700_000_100_000);
    await store.flush();
    const rooms = await admin`select uid, closed_at from rooms`;
    expect(rooms.map((r) => [r.uid, Number(r.closed_at)])).toEqual([["uid-1", 1_700_000_100_000]]);
    expect((await admin`select count(*)::int as n from actions`)[0]?.n).toBe(1);
  });

  it("writes in the order it was asked to, even in a burst", async () => {
    // An action's row needs its room's row first; a pool writing concurrently
    // would break that on the first busy moment.
    const store = await fresh();
    for (let r = 0; r < 5; r++) {
      store.saveRoom(record({ uid: `uid-${r}`, id: `ROOM${r}` }));
      for (let seq = 0; seq < 20; seq++) store.appendAction(`uid-${r}`, row(seq));
    }
    await store.flush();
    const open = await store.loadOpen();
    expect(open).toHaveLength(5);
    expect(open.every((room) => room.actions.length === 20)).toBe(true);
  });

  it("gives up on a write the database refuses, says so, and carries on with the rest", async () => {
    const errors: string[] = [];
    await wipe();
    const store = await openPostgresStore(url, {
      retryDelaysMs: [0],
      logger: { error: (message) => errors.push(message) },
    });
    opened.push(store);
    // No room row, so the foreign key refuses the action every time.
    store.appendAction("no-such-room", row(0));
    store.saveRoom(record());
    await store.flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/gave up on action 0 of no-such-room/);
    expect(await store.loadOpen()).toHaveLength(1);
  });

  it("takes a repeated action quietly, rather than failing on the key and giving up", async () => {
    // A retry after a write that landed but lost its reply would otherwise log a
    // lost write for a row that is in fact there.
    const errors: string[] = [];
    await wipe();
    const store = await openPostgresStore(url, {
      retryDelaysMs: [],
      logger: { error: (message) => errors.push(message) },
    });
    opened.push(store);
    store.saveRoom(record());
    store.appendAction("uid-1", row(0));
    store.appendAction("uid-1", row(0));
    await store.flush();
    expect(errors).toEqual([]);
  });

  it("refuses to open a database it cannot reach, and leaves no connection behind", async () => {
    const unreachable = url.replace(/@[^/]+\//, "@127.0.0.1:1/");
    await expect(openPostgresStore(unreachable)).rejects.toThrow();
  });
});
