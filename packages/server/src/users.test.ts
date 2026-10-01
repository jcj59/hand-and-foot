import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { openPostgresStore, type PostgresRoomStore } from "./postgres";
import { ownDatabase } from "./testDatabase";
import {
  IDENTITY_TAKEN,
  InMemoryUserStore,
  NOT_AN_IDENTITY,
  UNKNOWN_IDENTITY,
  hashSecret,
  registerUser,
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
        data: { userId: ana.userId, name: "Ana" },
      });
      const kept = await store.get(ana.userId);
      expect(kept).toEqual({
        userId: ana.userId,
        secretHash: await hashSecret(ana.secret),
        name: "Ana",
        createdAt: 1_000,
        updatedAt: 1_000,
      });
      expect(JSON.stringify(kept)).not.toContain(ana.secret);
    });

    it("lets the same browser come back and change its name, and remembers it otherwise", async () => {
      const store = await open();
      await registerUser(store, { ...ana, name: "Ana" }, 1_000);
      expect(await registerUser(store, { ...ana, name: "Annie" }, 2_000)).toEqual({
        ok: true,
        data: { userId: ana.userId, name: "Annie" },
      });
      // No name given: the one it had stands.
      expect(await registerUser(store, ana, 3_000)).toEqual({
        ok: true,
        data: { userId: ana.userId, name: "Annie" },
      });
      expect(await store.get(ana.userId)).toMatchObject({ createdAt: 1_000, updatedAt: 3_000 });
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

    it("will not overwrite an identity held under another secret, in the same step as the write", async () => {
      const store = await open();
      await registerUser(store, { ...ana, name: "Ana" }, 1_000);
      const held = (await store.get(ana.userId))!;
      const rival = { ...held, secretHash: await hashSecret("b".repeat(40)), name: "Mal" };
      expect(await store.put(rival)).toBe(false);
      expect(await store.get(ana.userId)).toEqual(held);
      expect(await store.put({ ...held, name: "Annie" })).toBe(true);
      expect((await store.get(ana.userId))!.name).toBe("Annie");
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
    const raced: UserStore = { get: async () => null, put: async () => false };
    expect(await registerUser(raced, ana, 1)).toEqual({ ok: false, error: IDENTITY_TAKEN });
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
    await admin`drop table if exists actions, rooms, users, schema_migrations`;
    await admin.end();
  });

  contract("postgres", async () => {
    await admin`drop table if exists actions, rooms, users, schema_migrations`;
    const store = await openPostgresStore(url, { retryDelaysMs: [] });
    opened.push(store);
    return store.users();
  });
});
