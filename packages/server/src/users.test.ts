import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MIGRATIONS, openPostgresStore, type PostgresRoomStore } from "./postgres";
import { ownDatabase } from "./testDatabase";
import { TRY_AGAIN } from "@hf/shared";
import {
  IDENTITY_TAKEN,
  InMemoryUserStore,
  NOT_AN_IDENTITY,
  UNKNOWN_IDENTITY,
  hashSecret,
  registerUser,
  upgradeUserRecord,
  verifyUser,
  type UserStore,
} from "./users";

const DATABASE_URL = process.env.HF_TEST_DATABASE_URL;

const ana = { userId: "ana-user-id-0001", secret: "a".repeat(40) };

function contract(name: string, open: () => Promise<UserStore>): void {
  describe(`${name}: identities`, () => {
    it("registers a new identity, keeping only a hash of its secret", async () => {
      const store = await open();
      expect(await registerUser(store, { ...ana, name: "  Ana  " }, 1_000)).toEqual({
        ok: true,
        data: { userId: ana.userId, name: "Ana", username: null },
      });
      const kept = await store.get(ana.userId);
      expect(kept).toEqual({
        userId: ana.userId,
        devices: [await hashSecret(ana.secret)],
        name: "Ana",
        username: null,
        createdAt: 1_000,
        updatedAt: 1_000,
        version: 1,
      });
      expect(JSON.stringify(kept)).not.toContain(ana.secret);
    });

    it("lets the same browser come back and change its name, and remembers it otherwise", async () => {
      const store = await open();
      await registerUser(store, { ...ana, name: "Ana" }, 1_000);
      expect(await registerUser(store, { ...ana, name: "Annie" }, 2_000)).toEqual({
        ok: true,
        data: { userId: ana.userId, name: "Annie", username: null },
      });
      // No name given: the one it had stands.
      expect(await registerUser(store, ana, 3_000)).toEqual({
        ok: true,
        data: { userId: ana.userId, name: "Annie", username: null },
      });
      expect(await store.get(ana.userId)).toMatchObject({
        createdAt: 1_000,
        updatedAt: 3_000,
        version: 3,
      });
    });

    it("refuses someone else's id with the wrong secret, changing nothing", async () => {
      const store = await open();
      await registerUser(store, { ...ana, name: "Ana" }, 1_000);
      const thief = { userId: ana.userId, secret: "b".repeat(40), name: "Mallory" };
      expect(await registerUser(store, thief, 2_000)).toEqual({ ok: false, error: IDENTITY_TAKEN });
      expect(await store.get(ana.userId)).toMatchObject({ name: "Ana", updatedAt: 1_000 });
    });

    it("refuses an identity that must already exist but does not, creating nothing", async () => {
      const store = await open();
      expect(await registerUser(store, { ...ana, existing: true }, 1_000)).toEqual({
        ok: false,
        error: UNKNOWN_IDENTITY,
      });
      expect(await store.get(ana.userId)).toBeNull();
      await registerUser(store, ana, 2_000);
      expect((await registerUser(store, { ...ana, existing: true }, 3_000)).ok).toBe(true);
    });

    it("writes only over the version a change was made from, in the same step as the write", async () => {
      const store = await open();
      await registerUser(store, { ...ana, name: "Ana" }, 1_000);
      const held = (await store.get(ana.userId))!;
      // Made from a version that is no longer the one stored, or skipping one.
      expect(await store.put({ ...held, name: "Stale" })).toBe(false);
      expect(await store.put({ ...held, name: "Ahead", version: 3 })).toBe(false);
      // A second identity under an id already taken.
      expect(await store.put({ ...held, name: "Mal", version: 1 })).toBe(false);
      expect(await store.get(ana.userId)).toEqual(held);
      expect(await store.put({ ...held, name: "Annie", version: 2 })).toBe(true);
      expect(await store.get(ana.userId)).toEqual({ ...held, name: "Annie", version: 2 });
    });

    it("keeps every device's secret apart, and a username, through a write", async () => {
      const store = await open();
      await registerUser(store, ana, 1_000);
      const held = (await store.get(ana.userId))!;
      const second = await hashSecret("c".repeat(40));
      const written = {
        ...held,
        devices: [...held.devices, second],
        username: "Ana.B",
        version: 2,
      };
      expect(await store.put(written)).toBe(true);
      expect(await store.get(ana.userId)).toEqual(written);
      expect(await verifyUser(store, { ...ana, secret: "c".repeat(40) })).toBe(ana.userId);
      expect(await verifyUser(store, ana)).toBe(ana.userId);
    });

    it("proves an identity only with its own secret", async () => {
      const store = await open();
      await registerUser(store, ana, 1_000);
      expect(await verifyUser(store, ana)).toBe(ana.userId);
      expect(await verifyUser(store, { ...ana, secret: "b".repeat(40) })).toBeNull();
      expect(
        await verifyUser(store, { userId: "nobody-registered-1", secret: ana.secret }),
      ).toBeNull();
      expect(await verifyUser(store, undefined)).toBeNull();
    });
  });
}

contract("in memory", async () => new InMemoryUserStore());

describe("when the store misbehaves", () => {
  it("reports a registration that lost a race to another browser", async () => {
    // The read saw nothing; by the write, someone else held the id.
    const inner = new InMemoryUserStore();
    const raced: UserStore = {
      get: (userId) => inner.get(userId),
      put: async (record) => {
        await registerUser(inner, { userId: ana.userId, secret: "b".repeat(40) }, 1);
        return inner.put(record);
      },
    };
    expect(await registerUser(raced, ana, 1)).toEqual({ ok: false, error: IDENTITY_TAKEN });
  });

  it("goes again after losing a race to its own device, and keeps both changes", async () => {
    // Two tabs of one browser renaming at once: the loser reads again and wins.
    const inner = new InMemoryUserStore();
    await registerUser(inner, { ...ana, name: "Ana" }, 1);
    let raced = false;
    const store: UserStore = {
      get: (userId) => inner.get(userId),
      put: async (record) => {
        if (!raced) {
          raced = true;
          await registerUser(inner, { ...ana, name: "Other tab" }, 2);
        }
        return inner.put(record);
      },
    };
    expect(await registerUser(store, { ...ana, name: "Annie" }, 3)).toMatchObject({
      ok: true,
      data: { name: "Annie" },
    });
    expect(await inner.get(ana.userId)).toMatchObject({ name: "Annie", version: 3 });
  });

  it("gives up, and says to try again, when every write loses a race", async () => {
    const inner = new InMemoryUserStore();
    await registerUser(inner, ana, 1);
    const busy: UserStore = { get: (userId) => inner.get(userId), put: async () => false };
    expect(await registerUser(busy, { ...ana, name: "Annie" }, 2)).toEqual({
      ok: false,
      error: TRY_AGAIN,
    });
  });

  it("proves nothing, rather than failing, when it cannot be read", async () => {
    const broken: UserStore = {
      get: async () => {
        throw new Error("database unreachable");
      },
      put: async () => true,
    };
    expect(await verifyUser(broken, ana)).toBeNull();
  });
});

describe("an identity stored before devices", () => {
  it("is read as one device, no username, at version 1", async () => {
    const legacy = {
      userId: ana.userId,
      secretHash: await hashSecret(ana.secret),
      name: "Ana",
      createdAt: 1,
      updatedAt: 2,
    };
    expect(upgradeUserRecord(legacy)).toEqual({
      userId: ana.userId,
      devices: [legacy.secretHash],
      name: "Ana",
      username: null,
      createdAt: 1,
      updatedAt: 2,
      version: 1,
    });
    const current = upgradeUserRecord(legacy);
    expect(upgradeUserRecord(current)).toBe(current);
  });
});

describe("what counts as an identity", () => {
  it("refuses anything but a long random id and secret", async () => {
    const store = new InMemoryUserStore();
    for (const bad of [
      null,
      "ana",
      { userId: "short", secret: ana.secret },
      { userId: ana.userId, secret: "too-short" },
      { userId: "has spaces in it!!", secret: ana.secret },
      { userId: ana.userId },
    ]) {
      expect(await registerUser(store, bad, 1)).toEqual({ ok: false, error: NOT_AN_IDENTITY });
    }
  });

  it("hashes with SHA-256", async () => {
    expect(await hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe.skipIf(DATABASE_URL === undefined)("Postgres", () => {
  let url = "";
  let admin: postgres.Sql;
  const opened: PostgresRoomStore[] = [];

  beforeAll(async () => {
    url = await ownDatabase(DATABASE_URL!, "hf_test_users");
    admin = postgres(url, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    for (const store of opened) await store.close();
    await admin`drop table if exists match_players, matches, actions, rooms, users, logins, schema_migrations`;
    await admin.end();
  });

  it("keeps an identity registered before devices, which still proves itself", async () => {
    await admin`drop table if exists match_players, matches, actions, rooms, users, logins, schema_migrations`;
    await admin`create table schema_migrations (version integer primary key, applied_at timestamptz not null default now())`;
    for (const [index, statement] of MIGRATIONS.slice(0, 6).entries()) {
      await admin.unsafe(statement);
      await admin`insert into schema_migrations (version) values (${index + 1})`;
    }
    await admin`insert into users (user_id, secret_hash, name, created_at, updated_at)
      values (${ana.userId}, ${await hashSecret(ana.secret)}, 'Ana', 1, 2)`;
    const store = await openPostgresStore(url, { retryDelaysMs: [] });
    opened.push(store);
    const users = store.users();
    expect(await users.get(ana.userId)).toEqual({
      userId: ana.userId,
      devices: [await hashSecret(ana.secret)],
      name: "Ana",
      username: null,
      createdAt: 1,
      updatedAt: 2,
      version: 1,
    });
    expect(await verifyUser(users, ana)).toBe(ana.userId);
    expect(await registerUser(users, { ...ana, name: "Annie" }, 3)).toMatchObject({ ok: true });
    expect(await users.get(ana.userId)).toMatchObject({ name: "Annie", version: 2 });
  });

  contract("postgres", async () => {
    await admin`drop table if exists match_players, matches, actions, rooms, users, logins, schema_migrations`;
    const store = await openPostgresStore(url, { retryDelaysMs: [] });
    opened.push(store);
    return store.users();
  });
});
