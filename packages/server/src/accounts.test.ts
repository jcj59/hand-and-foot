import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ALREADY_CLAIMED,
  BAD_PASSWORD,
  BAD_USERNAME,
  NOT_AN_IDENTITY,
  NOT_CLAIMED,
  TOO_MANY_TRIES,
  TRY_AGAIN,
  USERNAME_TAKEN,
  WRONG_PASSWORD,
  type SignedIn,
} from "@hf/shared";
import {
  changePassword,
  checkPassword,
  claimUsername,
  FIRST_LOCK_MS,
  FREE_TRIES,
  hashPassword,
  InMemoryLoginStore,
  lockFor,
  MAX_LOCK_MS,
  newSecret,
  PASSWORD_ROUNDS,
  signIn,
  signOut,
  type AccountStores,
  type LoginStore,
} from "./accounts";
import { openPostgresStore, type PostgresRoomStore } from "./postgres";
import { ownDatabase } from "./testDatabase";
import { InMemoryUserStore, MAX_DEVICES, registerUser, verifyUser, type UserStore } from "./users";

const DATABASE_URL = process.env.HF_TEST_DATABASE_URL;

const laptop = { userId: "ana-user-id-0001", secret: "a".repeat(40) };
const PASSWORD = "correct horse";

/** Ana's identity, made on her laptop and given a username. */
async function claimed(stores: AccountStores): Promise<void> {
  await registerUser(stores.users, { ...laptop, name: "Ana" }, 1);
  const answer = await claimUsername(
    stores,
    { user: laptop, username: "Ana.B", password: PASSWORD },
    2,
  );
  expect(answer).toEqual({ ok: true, data: { username: "Ana.B" } });
}

async function signedIn(
  stores: AccountStores,
  body: Record<string, unknown>,
  now = 10,
): Promise<SignedIn> {
  const answer = await signIn(stores, body, now);
  if (!answer.ok) throw new Error(answer.error);
  return answer.data;
}

function contract(name: string, open: () => Promise<AccountStores>): void {
  describe(`${name}: signing in`, () => {
    it("gives an identity a username, keeping only a salted hash of the password", async () => {
      const stores = await open();
      await claimed(stores);
      expect(await stores.users.get(laptop.userId)).toMatchObject({ username: "Ana.B" });
      const login = await stores.logins.get("ana.b");
      expect(login).toMatchObject({
        key: "ana.b",
        username: "Ana.B",
        userId: laptop.userId,
        failures: 0,
        lockedUntil: 0,
        version: 1,
      });
      expect(login!.passwordHash).toMatch(/^pbkdf2-sha256\$50000\$/);
      expect(JSON.stringify(login)).not.toContain(PASSWORD);
    });

    it("signs another device in with a secret of its own, and both devices are her", async () => {
      const stores = await open();
      await claimed(stores);
      // Typed on a phone, which capitalises what it likes.
      const phone = await signedIn(stores, { username: " ANA.b ", password: PASSWORD });
      expect(phone).toMatchObject({ userId: laptop.userId, username: "Ana.B", name: "Ana" });
      expect(phone.secret).not.toBe(laptop.secret);
      expect(await verifyUser(stores.users, phone)).toBe(laptop.userId);
      expect(await verifyUser(stores.users, laptop)).toBe(laptop.userId);
      expect((await stores.users.get(laptop.userId))!.devices).toHaveLength(2);
    });

    it("keeps every other device when one registers again, as each does before sitting down", async () => {
      const stores = await open();
      await claimed(stores);
      const phone = await signedIn(stores, { username: "ana.b", password: PASSWORD });
      expect((await registerUser(stores.users, { ...laptop, name: "Annie" }, 20)).ok).toBe(true);
      expect((await registerUser(stores.users, phone, 21)).ok).toBe(true);
      expect(await verifyUser(stores.users, laptop)).toBe(laptop.userId);
      expect(await verifyUser(stores.users, phone)).toBe(laptop.userId);
    });

    it("takes the name a device signs in under, and keeps the one it had otherwise", async () => {
      const stores = await open();
      await claimed(stores);
      await signedIn(stores, { username: "ana.b", password: PASSWORD, name: " Annie " });
      expect((await stores.users.get(laptop.userId))!.name).toBe("Annie");
    });

    it("answers a wrong password and an unknown username alike", async () => {
      const stores = await open();
      await claimed(stores);
      const refused = { ok: false, error: WRONG_PASSWORD };
      expect(await signIn(stores, { username: "ana.b", password: "wrong horse" }, 10)).toEqual(
        refused,
      );
      expect(await signIn(stores, { username: "nobody", password: PASSWORD }, 10)).toEqual(refused);
      expect(await signIn(stores, { username: "no", password: PASSWORD }, 10)).toEqual(refused);
      expect(await signIn(stores, { username: "nobody", password: 7 }, 10)).toEqual(refused);
      expect(await signIn(stores, { username: "ana.b" }, 10)).toEqual(refused);
      expect(
        await signIn(stores, { username: "ana.b", password: PASSWORD.padEnd(129, "!") }, 10),
      ).toEqual(refused);
      expect((await stores.users.get(laptop.userId))!.devices).toHaveLength(1);
    });

    it("locks a username after too many wrong passwords, longer each time, and a right one clears it", async () => {
      const stores = await open();
      await claimed(stores);
      const guess = (password: string, now: number) =>
        signIn(stores, { username: "ana.b", password }, now);
      for (let i = 0; i < FREE_TRIES; i++) {
        expect(await guess("wrong horse", 100)).toEqual({ ok: false, error: WRONG_PASSWORD });
      }
      // Locked now: even the right password is not checked.
      expect(await guess(PASSWORD, 100)).toEqual({ ok: false, error: TOO_MANY_TRIES });
      expect(await guess(PASSWORD, 100 + 59_999)).toEqual({ ok: false, error: TOO_MANY_TRIES });
      // The minute is up; one more wrong guess locks it for two.
      expect(await guess("wrong horse", 100 + 60_000)).toEqual({
        ok: false,
        error: WRONG_PASSWORD,
      });
      expect(await stores.logins.get("ana.b")).toMatchObject({
        failures: FREE_TRIES + 1,
        lockedUntil: 100 + 60_000 + 120_000,
      });
      expect((await guess(PASSWORD, 100 + 60_000 + 120_000)).ok).toBe(true);
      expect(await stores.logins.get("ana.b")).toMatchObject({ failures: 0, lockedUntil: 0 });
    });

    it("will not give a username to a device that does not hold the identity", async () => {
      const stores = await open();
      await registerUser(stores.users, laptop, 1);
      for (const user of [undefined, { ...laptop, secret: "z".repeat(40) }]) {
        expect(
          await claimUsername(stores, { user, username: "ana", password: PASSWORD }, 2),
        ).toEqual({ ok: false, error: NOT_AN_IDENTITY });
      }
      expect(await stores.logins.get("ana")).toBeNull();
    });

    it("refuses a username or password that is not one, claiming nothing", async () => {
      const stores = await open();
      await registerUser(stores.users, laptop, 1);
      const claim = (username: unknown, password: unknown) =>
        claimUsername(stores, { user: laptop, username, password }, 2);
      for (const username of ["ab", "a".repeat(25), "ana b", "ana!", 12]) {
        expect(await claim(username, PASSWORD)).toEqual({ ok: false, error: BAD_USERNAME });
      }
      for (const password of ["short", "x".repeat(129), undefined]) {
        expect(await claim("ana", password)).toEqual({ ok: false, error: BAD_PASSWORD });
      }
      expect(await stores.logins.get("ana")).toBeNull();
      expect((await stores.users.get(laptop.userId))!.username).toBeNull();
    });

    it("gives each username to one identity only, whatever its case, and an identity one username", async () => {
      const stores = await open();
      await claimed(stores);
      const ben = { userId: "ben-user-id-0002", secret: "b".repeat(40) };
      await registerUser(stores.users, ben, 1);
      expect(
        await claimUsername(stores, { user: ben, username: "ANA.B", password: PASSWORD }, 3),
      ).toEqual({ ok: false, error: USERNAME_TAKEN });
      expect(
        await claimUsername(stores, { user: laptop, username: "Ana2", password: PASSWORD }, 3),
      ).toEqual({ ok: false, error: ALREADY_CLAIMED });
      expect(await stores.logins.get("ana2")).toBeNull();
      expect((await stores.logins.get("ana.b"))!.userId).toBe(laptop.userId);
    });

    it("changes the password from a signed-in device and signs every other device out", async () => {
      const stores = await open();
      await claimed(stores);
      const phone = await signedIn(stores, { username: "ana.b", password: PASSWORD });
      const tablet = await signedIn(stores, { username: "ana.b", password: PASSWORD });
      expect(
        await changePassword(
          stores,
          { user: phone, password: PASSWORD, newPassword: "battery staple" },
          20,
        ),
      ).toEqual({ ok: true, data: null });
      expect(await verifyUser(stores.users, phone)).toBe(laptop.userId);
      expect(await verifyUser(stores.users, laptop)).toBeNull();
      expect(await verifyUser(stores.users, tablet)).toBeNull();
      // The laptop, signed out, finds its credentials are someone else's now.
      expect(await registerUser(stores.users, laptop, 21)).toMatchObject({ ok: false });
      expect((await signIn(stores, { username: "ana.b", password: PASSWORD }, 22)).ok).toBe(false);
      expect((await signIn(stores, { username: "ana.b", password: "battery staple" }, 22)).ok).toBe(
        true,
      );
    });

    it("changes the password only knowing the current one, counting a wrong one", async () => {
      const stores = await open();
      await claimed(stores);
      const change = (body: Record<string, unknown>) =>
        changePassword(stores, { user: laptop, ...body }, 20);
      expect(await change({ password: "wrong horse", newPassword: "battery staple" })).toEqual({
        ok: false,
        error: WRONG_PASSWORD,
      });
      expect((await stores.logins.get("ana.b"))!.failures).toBe(1);
      expect(await change({ password: PASSWORD, newPassword: "short" })).toEqual({
        ok: false,
        error: BAD_PASSWORD,
      });
      expect(
        await changePassword(
          stores,
          { user: undefined, password: PASSWORD, newPassword: "battery staple" },
          20,
        ),
      ).toEqual({ ok: false, error: NOT_AN_IDENTITY });
      expect(await checkPassword(PASSWORD, (await stores.logins.get("ana.b"))!.passwordHash)).toBe(
        true,
      );
    });

    it("has no password to change on an identity without a username", async () => {
      const stores = await open();
      await registerUser(stores.users, laptop, 1);
      expect(
        await changePassword(
          stores,
          { user: laptop, password: PASSWORD, newPassword: "battery staple" },
          2,
        ),
      ).toEqual({ ok: false, error: NOT_CLAIMED });
    });

    it("signs out just the one device, and signing out twice is no failure", async () => {
      const stores = await open();
      await claimed(stores);
      const phone = await signedIn(stores, { username: "ana.b", password: PASSWORD });
      expect(await signOut(stores, { user: phone }, 20)).toEqual({ ok: true, data: null });
      expect(await verifyUser(stores.users, phone)).toBeNull();
      expect(await verifyUser(stores.users, laptop)).toBe(laptop.userId);
      expect(await signOut(stores, { user: phone }, 21)).toEqual({ ok: true, data: null });
      expect(await signOut(stores, {}, 21)).toEqual({ ok: true, data: null });
      // Signed out, the phone signs in again with the password.
      expect((await signIn(stores, { username: "ana.b", password: PASSWORD }, 22)).ok).toBe(true);
    });

    it(`keeps the newest ${MAX_DEVICES} devices`, async () => {
      const stores = await open();
      await claimed(stores);
      const devices: SignedIn[] = [];
      for (let i = 0; i < MAX_DEVICES; i++) {
        devices.push(await signedIn(stores, { username: "ana.b", password: PASSWORD }, 10 + i));
      }
      expect(await verifyUser(stores.users, laptop)).toBeNull();
      expect(await verifyUser(stores.users, devices[0]!)).toBe(laptop.userId);
      expect((await stores.users.get(laptop.userId))!.devices).toHaveLength(MAX_DEVICES);
    });

    it("writes a username only over the version it was read at, and gives one back only to its own", async () => {
      const { logins } = await open();
      const record = {
        key: "ana",
        username: "Ana",
        userId: laptop.userId,
        passwordHash: await hashPassword(PASSWORD),
        failures: 0,
        lockedUntil: 0,
        createdAt: 1,
        updatedAt: 1,
        version: 1,
      };
      expect(await logins.put(record)).toBe(true);
      expect(await logins.put({ ...record, userId: "someone-else-0001" })).toBe(false);
      expect(await logins.put({ ...record, failures: 1, version: 3 })).toBe(false);
      expect(await logins.put({ ...record, failures: 1, lockedUntil: 9, version: 2 })).toBe(true);
      expect(await logins.get("ana")).toEqual({
        ...record,
        failures: 1,
        lockedUntil: 9,
        version: 2,
      });
      await logins.delete("ana", "someone-else-0001");
      expect(await logins.get("ana")).not.toBeNull();
      await logins.delete("ana", laptop.userId);
      expect(await logins.get("ana")).toBeNull();
    });
  });
}

contract("in memory", async () => ({
  users: new InMemoryUserStore(),
  logins: new InMemoryLoginStore(),
}));

describe("when a write loses a race", () => {
  it("gives a username back when the identity took another meanwhile", async () => {
    const users = new InMemoryUserStore();
    const inner = new InMemoryLoginStore();
    await registerUser(users, laptop, 1);
    // A second tab claims "Annie" while this one is between its two writes.
    let raced = false;
    const logins: LoginStore = {
      get: (key) => inner.get(key),
      delete: (key, userId) => inner.delete(key, userId),
      put: async (record) => {
        const written = await inner.put(record);
        if (!raced) {
          raced = true;
          await claimUsername(
            { users, logins: inner },
            { user: laptop, username: "Annie", password: PASSWORD },
            2,
          );
        }
        return written;
      },
    };
    expect(
      await claimUsername(
        { users, logins },
        { user: laptop, username: "Ana", password: PASSWORD },
        3,
      ),
    ).toEqual({ ok: false, error: ALREADY_CLAIMED });
    expect(await inner.get("ana")).toBeNull();
    expect((await users.get(laptop.userId))!.username).toBe("Annie");
  });

  it("claims nothing for an identity gone between the check and the write", async () => {
    const inner = new InMemoryUserStore();
    await registerUser(inner, laptop, 1);
    let reads = 0;
    const users: UserStore = {
      get: async (userId) => (reads++ === 0 ? inner.get(userId) : null),
      put: (record) => inner.put(record),
    };
    const logins = new InMemoryLoginStore();
    expect(
      await claimUsername(
        { users, logins },
        { user: laptop, username: "Ana", password: PASSWORD },
        2,
      ),
    ).toEqual({ ok: false, error: NOT_AN_IDENTITY });
    expect(await logins.get("ana")).toBeNull();
  });

  it("counts every wrong guess, even ones that arrive together", async () => {
    const stores = { users: new InMemoryUserStore(), logins: new InMemoryLoginStore() };
    await claimed(stores);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        signIn(stores, { username: "ana.b", password: "wrong horse" }, 10),
      ),
    );
    expect((await stores.logins.get("ana.b"))!.failures).toBe(4);
  });

  it("gives up on a sign-in whose login never stops changing, without counting a wrong guess", async () => {
    const stores = { users: new InMemoryUserStore(), logins: new InMemoryLoginStore() };
    await claimed(stores);
    await signIn(stores, { username: "ana.b", password: "wrong horse" }, 10);
    const busy: AccountStores = {
      users: stores.users,
      logins: {
        get: (key) => stores.logins.get(key),
        delete: (key, userId) => stores.logins.delete(key, userId),
        put: async () => false,
      },
    };
    expect(await signIn(busy, { username: "ana.b", password: PASSWORD }, 11)).toEqual({
      ok: false,
      error: TRY_AGAIN,
    });
    expect(await signIn(busy, { username: "ana.b", password: "wrong horse" }, 11)).toEqual({
      ok: false,
      error: WRONG_PASSWORD,
    });
  });

  it("says to try again when a new password cannot be written", async () => {
    const stores = { users: new InMemoryUserStore(), logins: new InMemoryLoginStore() };
    await claimed(stores);
    const flaky: LoginStore = {
      get: (key) => stores.logins.get(key),
      delete: (key, userId) => stores.logins.delete(key, userId),
      put: async () => false,
    };
    expect(
      await changePassword(
        { users: stores.users, logins: flaky },
        { user: laptop, password: PASSWORD, newPassword: "battery staple" },
        20,
      ),
    ).toEqual({ ok: false, error: TRY_AGAIN });
  });

  it("does not sign out the device that changed the password if it was signed out meanwhile", async () => {
    const stores = { users: new InMemoryUserStore(), logins: new InMemoryLoginStore() };
    await claimed(stores);
    const phone = await signedIn(stores, { username: "ana.b", password: PASSWORD });
    // The laptop signs itself out between the password being written and the devices.
    const original = (await stores.logins.get("ana.b"))!.passwordHash;
    const logins: LoginStore = {
      get: (key) => stores.logins.get(key),
      delete: (key, userId) => stores.logins.delete(key, userId),
      put: async (record) => {
        const written = await stores.logins.put(record);
        if (record.passwordHash !== original) await signOut(stores, { user: laptop }, 19);
        return written;
      },
    };
    expect(
      await changePassword(
        { users: stores.users, logins },
        { user: laptop, password: PASSWORD, newPassword: "battery staple" },
        20,
      ),
    ).toEqual({ ok: false, error: NOT_AN_IDENTITY });
    expect(await verifyUser(stores.users, phone)).toBe(laptop.userId);
  });

  it("never takes a missing password as the word for one", async () => {
    const stores = { users: new InMemoryUserStore(), logins: new InMemoryLoginStore() };
    await registerUser(stores.users, laptop, 1);
    await claimUsername(stores, { user: laptop, username: "ana", password: "undefined" }, 2);
    expect(await signIn(stores, { username: "ana" }, 3)).toEqual({
      ok: false,
      error: WRONG_PASSWORD,
    });
    expect((await signIn(stores, { username: "ana", password: "undefined" }, 4)).ok).toBe(true);
  });

  it("changes no password through a username that leads to someone else", async () => {
    // Cannot happen through these rules; if a store ever disagreed with itself, an
    // identity's username must not open another identity's login.
    const stores = { users: new InMemoryUserStore(), logins: new InMemoryLoginStore() };
    await claimed(stores);
    const mal = { userId: "mal-user-id-0009", secret: "m".repeat(40) };
    await registerUser(stores.users, mal, 1);
    const held = (await stores.users.get(mal.userId))!;
    await stores.users.put({ ...held, username: "Ana.B", version: held.version + 1 });
    expect(
      await changePassword(
        stores,
        { user: mal, password: PASSWORD, newPassword: "battery staple" },
        20,
      ),
    ).toEqual({ ok: false, error: NOT_CLAIMED });
    expect(await checkPassword(PASSWORD, (await stores.logins.get("ana.b"))!.passwordHash)).toBe(
      true,
    );
  });

  it("answers a username whose identity is gone as if there were no such username", async () => {
    const stores = { users: new InMemoryUserStore(), logins: new InMemoryLoginStore() };
    await claimed(stores);
    const forgetful: UserStore = { get: async () => null, put: async () => false };
    expect(
      await signIn(
        { users: forgetful, logins: stores.logins },
        { username: "ana.b", password: PASSWORD },
        10,
      ),
    ).toEqual({ ok: false, error: WRONG_PASSWORD });
  });
});

describe("passwords", () => {
  it("are hashed with PBKDF2 at 50,000 rounds, salted afresh each time", async () => {
    expect(PASSWORD_ROUNDS).toBe(50_000);
    const one = await hashPassword(PASSWORD);
    const two = await hashPassword(PASSWORD);
    expect(one).toMatch(/^pbkdf2-sha256\$50000\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(one).not.toBe(two);
    expect(await checkPassword(PASSWORD, one)).toBe(true);
    expect(await checkPassword(PASSWORD, two)).toBe(true);
    expect(await checkPassword("correct horsE", one)).toBe(false);
  });

  it("are checked at the rounds each hash was made with", async () => {
    const light = await hashPassword(PASSWORD, 1_000);
    expect(light).toMatch(/^pbkdf2-sha256\$1000\$/);
    expect(await checkPassword(PASSWORD, light)).toBe(true);
    // The same hash read at another count is another hash.
    expect(await checkPassword(PASSWORD, light.replace("$1000$", "$1001$"))).toBe(false);
  });

  it("never match a stored hash that is not one", async () => {
    for (const stored of [
      "",
      "plain",
      "md5$1$a$b",
      "pbkdf2-sha256$1000$$",
      "pbkdf2-sha256$1000$AAAA",
      "pbkdf2-sha256$1000$not base64!$AAAA",
      "pbkdf2-sha256$none$AAAA$AAAA",
    ]) {
      expect(await checkPassword(PASSWORD, stored)).toBe(false);
    }
    // A hash cut short is not a prefix match.
    const whole = await hashPassword(PASSWORD, 1_000);
    expect(await checkPassword(PASSWORD, whole.slice(0, -4))).toBe(false);
  });

  it("lock a username for a minute after five wrong, doubling to an hour at most", () => {
    expect([FREE_TRIES, FIRST_LOCK_MS, MAX_LOCK_MS]).toEqual([5, 60_000, 3_600_000]);
    expect([4, 5, 6, 7, 10, 11, 50].map(lockFor)).toEqual([
      0, 60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000,
    ]);
  });

  it("give each new device a secret that counts as a browser's own", () => {
    const secret = newSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(secret);
  });
});

describe.skipIf(DATABASE_URL === undefined)("Postgres", () => {
  let url = "";
  let admin: postgres.Sql;
  const opened: PostgresRoomStore[] = [];

  beforeAll(async () => {
    url = await ownDatabase(DATABASE_URL!, "hf_test_accounts");
    admin = postgres(url, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    for (const store of opened) await store.close();
    await admin`drop table if exists match_players, matches, actions, rooms, users, logins, schema_migrations`;
    await admin.end();
  });

  contract("postgres", async () => {
    await admin`drop table if exists match_players, matches, actions, rooms, users, logins, schema_migrations`;
    const store = await openPostgresStore(url, { retryDelaysMs: [] });
    opened.push(store);
    return { users: store.users(), logins: store.logins() };
  });
});
