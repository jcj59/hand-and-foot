/**
 * Keeping matches: the store contract, in memory and on Postgres; what a table
 * sends to be kept and when; and a player asking for their history.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { EAST_COAST, type MatchRecord, type RulesConfig } from "@hf/shared";
import { defaultAction } from "@hf/engine";
import { FakeClock } from "./clock";
import { RoomManager } from "./manager";
import { InMemoryMatchStore, keptFor, matchHistory, type MatchStore } from "./matches";
import { openPostgresStore, type PostgresRoomStore } from "./postgres";
import { BOT_MOVE_MS, Room } from "./room";
import { ownDatabase } from "./testDatabase";
import { InMemoryUserStore, registerUser } from "./users";

const DATABASE_URL = process.env.HF_TEST_DATABASE_URL;

/** Short rounds: no extra decks, and a round ends when the stock does. */
const SHORT: RulesConfig = {
  ...EAST_COAST,
  extraDecks: 0,
  stockExhaustion: "end",
  rounds: 2,
  layDownMinimums: [60, 90],
};

function record(id: string, endedAt: number, users: readonly (string | undefined)[]): MatchRecord {
  return {
    id,
    roomId: "ABC234",
    startedAt: endedAt - 100,
    endedAt,
    config: SHORT,
    seed: 1,
    firstSeat: 0,
    seats: users.map((userId, seat) => ({ seat, name: `p${seat}`, ...(userId ? { userId } : {}) })),
    log: [{ seat: 0, action: { type: "draw" }, source: "player" }],
    summary: {
      roundsPlayed: 0,
      rounds: [],
      totals: users.map(() => 0),
      finished: false,
      winners: [],
      departed: [],
      tallies: users.map(() => ({
        pilesTaken: 0,
        grabbyPants: 0,
        marvaRules: 0,
        wentOut: 0,
        cleanBooks: 0,
        dirtyBooks: 0,
      })),
    },
  };
}

function contract(name: string, make: () => Promise<MatchStore>): void {
  describe(`match store: ${name}`, () => {
    it("keeps a match for each identity that played it, and gives it back whole", async () => {
      const store = await make();
      const m = record("m1", 2_000, ["u-a", undefined, "u-b"]);
      await store.save(m);
      expect(await store.forUser("u-a")).toEqual([m]);
      expect(await store.forUser("u-b")).toEqual([m]);
      expect(await store.forUser("u-c")).toEqual([]);
    });

    it("replaces a match saved again under the same id, keeping one copy", async () => {
      const store = await make();
      await store.save(record("m1", 2_000, ["u-a"]));
      const finished = { ...record("m1", 3_000, ["u-a"]), roomId: "XYZ234" };
      await store.save(finished);
      expect(await store.forUser("u-a")).toEqual([finished]);
    });

    it("keeps every match, newest first where the store orders them", async () => {
      const store = await make();
      await store.save(record("old", 1_000, ["u-a"]));
      await store.save(record("new", 5_000, ["u-a", "u-b"]));
      const ids = (await store.forUser("u-a")).map((m) => m.id).sort();
      expect(ids).toEqual(["new", "old"]);
    });
  });
}

contract("in memory", async () => new InMemoryMatchStore());

describe.skipIf(DATABASE_URL === undefined)("Postgres", () => {
  let url = "";
  let admin: postgres.Sql;
  const opened: PostgresRoomStore[] = [];

  beforeAll(async () => {
    url = await ownDatabase(DATABASE_URL!, "hf_test_matches");
    admin = postgres(url, { max: 1, onnotice: () => {} });
  });

  async function wipe(): Promise<void> {
    await admin`drop table if exists match_players, matches, actions, rooms, users, schema_migrations`;
  }

  afterAll(async () => {
    for (const store of opened) await store.close();
    await wipe();
    await admin.end();
  });

  contract("postgres", async () => {
    await wipe();
    const store = await openPostgresStore(url, { retryDelaysMs: [] });
    opened.push(store);
    return store.matches();
  });

  it("orders a player's matches newest first", async () => {
    await wipe();
    const store = await openPostgresStore(url, { retryDelaysMs: [] });
    opened.push(store);
    const kept = store.matches();
    await kept.save(record("old", 1_000, ["u-a"]));
    await kept.save(record("new", 5_000, ["u-a"]));
    expect((await kept.forUser("u-a")).map((m) => m.id)).toEqual(["new", "old"]);
  });
});

describe("who a match is kept for", () => {
  it("is the people who played it under an identity, never a computer", () => {
    const m = record("m", 1, ["u-a", undefined, "u-bot"]);
    const withBot = {
      ...m,
      seats: m.seats.map((s) => (s.seat === 2 ? { ...s, bot: true as const } : s)),
    };
    expect(keptFor(withBot)).toEqual(["u-a"]);
  });
});

/** A two-seat table, Ana with an identity, playing the safe default to the end of each round. */
function table(kept: MatchRecord[], profile: { userId?: string } = { userId: "u-ana" }) {
  const clock = new FakeClock(1_700_000_000_000);
  let token = 0;
  const room = new Room("KEEP23", SHORT, {
    clock,
    seed: 21,
    newToken: () => `t${token++}`,
    uid: "uid-keep",
    pauseWhenIdle: false,
    recordMatch: (r) => kept.push(r),
  });
  room.join("ana", profile);
  room.join("ben");
  room.start(0);
  const finishRound = (): void => {
    for (let guard = 0; !room.gameState!.roundEnded; guard++) {
      expect(guard).toBeLessThan(3_000);
      const state = room.gameState!;
      room.submitAction(state.currentSeat, defaultAction(state)!);
    }
  };
  return { room, clock, finishRound };
}

describe("a table keeping its match", () => {
  it("sends it once, when the last round ends, with the log that replays it", () => {
    const kept: MatchRecord[] = [];
    const { room, finishRound } = table(kept);
    finishRound();
    expect(kept).toHaveLength(0);
    room.readyForNextRound(0);
    room.readyForNextRound(1);
    finishRound();
    expect(kept).toHaveLength(1);
    const m = kept[0]!;
    expect(m).toMatchObject({
      id: "uid-keep",
      roomId: "KEEP23",
      seed: 21,
      firstSeat: 0,
      config: SHORT,
      seats: [
        { seat: 0, name: "ana", userId: "u-ana" },
        { seat: 1, name: "ben" },
      ],
    });
    expect(m.log).toHaveLength(room.log.length);
    expect(m.log[0]).toEqual({
      seat: room.log.entries()[0]!.seat,
      action: room.log.entries()[0]!.action,
      source: "player",
    });
    expect(m.summary).toMatchObject({ finished: true, roundsPlayed: 2 });
    expect(m.summary.totals).toEqual(room.result()!.totals);
    expect(m.startedAt).toBe(room.log.entries()[0]!.at);
  });

  it("sends nothing for a match nobody played under an identity", () => {
    const kept: MatchRecord[] = [];
    const { room, finishRound } = table(kept, {});
    finishRound();
    room.readyForNextRound(0);
    room.readyForNextRound(1);
    finishRound();
    room.recordUnfinished();
    expect(kept).toEqual([]);
  });

  it("sends one closed part way when asked, as far as it got, but not a finished one again", () => {
    const kept: MatchRecord[] = [];
    const { room, finishRound } = table(kept);
    finishRound();
    room.recordUnfinished();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.summary).toMatchObject({ finished: false, roundsPlayed: 1, winners: [] });
    room.readyForNextRound(0);
    room.readyForNextRound(1);
    finishRound();
    expect(kept).toHaveLength(2);
    room.recordUnfinished();
    expect(kept).toHaveLength(2);
  });

  it("has nothing to send before the deal", () => {
    const kept: MatchRecord[] = [];
    const room = new Room("NEW234", SHORT, {
      clock: new FakeClock(),
      seed: 1,
      newToken: () => "t",
      recordMatch: (r) => kept.push(r),
    });
    room.join("ana", { userId: "u-ana" });
    expect(room.matchRecord()).toBeNull();
    room.recordUnfinished();
    expect(kept).toEqual([]);
  });

  it("marks a computer player in the match it keeps", () => {
    const kept: MatchRecord[] = [];
    const clock = new FakeClock(1_700_000_000_000);
    let token = 0;
    const room = new Room("BOTS45", SHORT, {
      clock,
      seed: 21,
      newToken: () => `t${token++}`,
      pauseWhenIdle: false,
      recordMatch: (r) => kept.push(r),
    });
    room.join("ana", { userId: "u-ana" });
    room.addBot(0);
    room.start(0);
    for (let guard = 0; !room.matchOver; guard++) {
      expect(guard).toBeLessThan(10_000);
      const state = room.gameState!;
      if (state.roundEnded) room.readyForNextRound(0);
      else if (state.currentSeat === 0) room.submitAction(0, defaultAction(state)!);
      else clock.advance(BOT_MOVE_MS);
    }
    expect(kept[0]!.seats[1]).toMatchObject({ name: "Robo Rita", bot: true });
    expect(kept[0]!.log.some((m) => m.source === "bot")).toBe(true);
  });
});

describe("a table closed part way through", () => {
  it("is kept by the manager as far as it got", () => {
    const kept: MatchRecord[] = [];
    const manager = new RoomManager({ clock: new FakeClock(), recordMatch: (r) => kept.push(r) });
    const room = manager.create(SHORT);
    room.join("ana", { userId: "u-ana" });
    room.join("ben");
    room.start(0);
    manager.remove(room.id, "abandoned");
    expect(kept).toHaveLength(1);
    expect(kept[0]!.summary.finished).toBe(false);
  });
});

describe("a table whose match cannot be recorded", () => {
  it("still accepts the move when the record cannot be built", () => {
    const kept: MatchRecord[] = [];
    const { room, finishRound } = table(kept);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const entries = room.log.entries();
      const bad = { ...entries[0]!, action: { type: "nextRound" as const } };
      vi.spyOn(room.log, "entries").mockReturnValue([bad, ...entries.slice(1)]);
      expect(() => room.recordUnfinished()).not.toThrow();
      expect(() => finishRound()).not.toThrow();
      expect(kept).toEqual([]);
      expect(log).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("leaves a room removable when the record cannot be saved", () => {
    const manager = new RoomManager({
      clock: new FakeClock(),
      recordMatch: () => {
        throw new Error("store down");
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const room = manager.create(SHORT);
      room.join("ana", { userId: "u-ana" });
      room.join("ben");
      room.start(0);
      expect(() => manager.remove(room.id, "abandoned")).not.toThrow();
      expect(manager.get(room.id)).toBeUndefined();
      expect(log).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("a player's history", () => {
  const ana = { userId: "a".repeat(16), secret: "s".repeat(32) };

  it("is their stats and recent matches, for the identity the request proves", async () => {
    const users = new InMemoryUserStore();
    await registerUser(users, { ...ana, name: "ana" }, 1);
    const matches = new InMemoryMatchStore();
    await matches.save(record("m1", 2_000, [ana.userId, undefined]));
    const answer = await matchHistory(users, matches, { user: ana });
    expect(answer.ok && answer.data.recent.map((m) => m.id)).toEqual(["m1"]);
    expect(answer.ok && answer.data.stats.unfinished).toBe(1);
  });

  it("is refused for credentials that do not prove an identity", async () => {
    const users = new InMemoryUserStore();
    await registerUser(users, { ...ana, name: "ana" }, 1);
    const matches = new InMemoryMatchStore();
    const refused = { ok: false, error: "that is not an identity" };
    expect(
      await matchHistory(users, matches, { user: { ...ana, secret: "x".repeat(32) } }),
    ).toEqual(refused);
    expect(await matchHistory(users, matches, {})).toEqual(refused);
    expect(await matchHistory(users, matches, null)).toEqual(refused);
  });
});

describe("a player's history over HTTP", () => {
  it("is answered by the server for a match played at it", async () => {
    const { createServer } = await import("./index");
    const server = createServer();
    try {
      const port = await server.listen(0);
      const base = `http://localhost:${port}`;
      const post = async (path: string, body: unknown): Promise<unknown> =>
        (await fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) })).json();
      const user = { userId: "h".repeat(16), secret: "k".repeat(32) };
      expect(await post("/api/users", { ...user, name: "ana" })).toMatchObject({ ok: true });
      const opened = (await post("/api/rooms", {
        name: "ana",
        user,
        options: {
          rules: { extraDecks: 0, stockExhaustion: "end", rounds: 1, layDownMinimums: [60] },
        },
      })) as { ok: true; data: { roomId: string } };
      const room = server.manager.get(opened.data.roomId)!;
      room.addBot(0);
      room.start(0);
      for (let guard = 0; !room.matchOver; guard++) {
        expect(guard).toBeLessThan(5_000);
        const state = room.gameState!;
        // Play every seat on the room itself; the computer's own timer is not waited for.
        room.submitAction(state.currentSeat, defaultAction(state)!);
      }
      // Kept behind the game; give the store its turn.
      await new Promise((resolve) => setTimeout(resolve, 10));
      const history = (await post("/api/users/matches", { user })) as {
        ok: true;
        data: { stats: { played: number }; recent: { roomId: string; players: unknown[] }[] };
      };
      expect(history.ok).toBe(true);
      expect(history.data.stats.played).toBe(1);
      expect(history.data.recent[0]!.roomId).toBe(opened.data.roomId);
      expect(history.data.recent[0]!.players).toHaveLength(2);
      expect(
        await post("/api/users/matches", { user: { ...user, secret: "z".repeat(32) } }),
      ).toEqual({ ok: false, error: "that is not an identity" });
    } finally {
      await server.close();
    }
  });
});
