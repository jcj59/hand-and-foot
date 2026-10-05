// @vitest-environment node
// Against a real server, so in Node rather than the simulated browser, as the
// other integration tests are; each device's storage is a map of its own.
/**
 * Being one player on two devices, against a real server, through the client's own
 * identity layer and HTTP: a laptop gives its profile a username, a phone signs in
 * with it and sits down as the same player, and a new password from the phone
 * signs the laptop out — which the laptop finds out the next time it registers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type HandAndFootServer } from "@hf/server";
import {
  changePassword,
  claimAccount,
  httpPost,
  loadAccount,
  loadIdentity,
  prepareIdentity,
  signIn,
  signOut,
  type Post,
} from "./identity";
import { connect, createRoom, type HfClientSocket } from "./socket";

/** A device's local storage: just what `identity.ts` uses of it. */
function device(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as Storage;
}

/** Make `device` the one the identity layer is running on. */
function use(storage: Storage): void {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

let server: HandAndFootServer;
let url: string;
let post: Post;
const sockets: HfClientSocket[] = [];

beforeEach(async () => {
  server = createServer();
  url = `http://localhost:${await server.listen(0)}`;
  post = httpPost(url);
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
  delete (globalThis as { window?: unknown }).window;
});

async function sitDown(): Promise<string | undefined> {
  const socket = connect(url);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  const created = await createRoom(socket, "Ana", undefined, await prepareIdentity(post, "Ana"));
  if (!created.ok) throw new Error(created.error);
  return server.manager.get(created.data.roomId)!.record().players[0]!.userId;
}

describe("one player on two devices", () => {
  it("signs a phone in to the laptop's profile, and a new password signs the laptop out", async () => {
    const laptop = device();
    const phone = device();

    use(laptop);
    expect(await claimAccount(post, "Ana", "correct horse")).toEqual({ ok: true, data: "Ana" });
    const ana = loadIdentity()!.userId;
    expect(await sitDown()).toBe(ana);

    use(phone);
    expect(await signIn(post, "ANA", "wrong horse")).toEqual({
      ok: false,
      error: "that username and password do not match",
    });
    expect((await signIn(post, "ana", "correct horse")).ok).toBe(true);
    expect(loadIdentity()!.userId).toBe(ana);
    expect(loadAccount()).toBe("Ana");
    // The phone sits down as Ana, with a secret the laptop never had.
    expect(await sitDown()).toBe(ana);
    expect(loadIdentity()!.secret).not.toBe(JSON.parse(laptop.getItem("hf.identity")!).secret);

    expect(await changePassword(post, "correct horse", "battery staple")).toEqual({
      ok: true,
      data: null,
    });

    // The laptop learns it was signed out the next time it registers, and starts afresh.
    use(laptop);
    expect(loadAccount()).toBe("Ana");
    const fresh = await prepareIdentity(post, "Ana");
    expect(fresh!.userId).not.toBe(ana);
    expect(loadAccount()).toBeNull();
    expect((await signIn(post, "ana", "correct horse")).ok).toBe(false);
    expect((await signIn(post, "ana", "battery staple")).ok).toBe(true);
    expect(loadIdentity()!.userId).toBe(ana);

    // Signing the phone out leaves the laptop signed in.
    use(phone);
    const phoneSecret = loadIdentity()!;
    await signOut(post);
    expect(loadIdentity()).toBeNull();
    use(laptop);
    expect((await prepareIdentity(post, "Ana"))!.userId).toBe(ana);
    expect(loadAccount()).toBe("Ana");
    use(phone);
    phone.setItem("hf.identity", JSON.stringify(phoneSecret));
    expect((await prepareIdentity(post, "Ana"))!.userId).not.toBe(ana);
  });
});
