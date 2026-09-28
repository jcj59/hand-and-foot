/**
 * Keeping a seat across a dropped connection, against a real server.
 *
 * The rest of the client suite drives a hand-built socket, which can only confirm
 * that the client sends what it means to. Whether the server then treats the new
 * socket as seated is the part that actually decides if a player can keep playing,
 * so this drives the client's own modules — the socket helpers, the action layer
 * and the store — against a real `createServer` on an ephemeral port.
 *
 * A dropped transport is the case that matters in production, because every
 * deploy of the server restarts it and hands every open tab a new socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type HandAndFootServer } from "@hf/server";
import { reclaimOnReconnect, TABLE_GONE } from "./actions";
import { attachSession, useSession } from "./session";
import { connect, createRoom, joinRoom, setPaused, startGame, type HfClientSocket } from "./socket";

let server: HandAndFootServer;
let url: string;
const sockets: HfClientSocket[] = [];
const teardowns: (() => void)[] = [];

function open(): HfClientSocket {
  const socket = connect(url);
  sockets.push(socket);
  return socket;
}

function connected(socket: HfClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.connected) resolve();
    else socket.once("connect", () => resolve());
  });
}

/** Wire a socket to the store the way `App` does, including the reconnect reclaim. */
function mount(socket: HfClientSocket): void {
  const store = useSession.getState();
  teardowns.push(attachSession(socket, store));
  teardowns.push(
    reclaimOnReconnect(socket, {
      credentials: () => useSession.getState().credentials,
      seat: store.seat,
      leave: store.leave,
      setNotice: store.setNotice,
    }),
  );
}

/** Drop the transport and let socket.io reconnect on its own, as a network blip does. */
async function dropTransport(socket: HfClientSocket): Promise<void> {
  const back = new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  socket.io.engine.close();
  await back;
}

/** A dealt two-seat table, with Alice's tab mounted on the store. */
async function dealtTable(): Promise<{ alice: HfClientSocket; roomId: string }> {
  const alice = open();
  const bob = open();
  mount(alice);
  await Promise.all([connected(alice), connected(bob)]);
  const created = await createRoom(alice, "Alice", { mode: "family" });
  if (!created.ok) throw new Error(created.error);
  useSession.getState().seat(created.data);
  const joined = await joinRoom(bob, created.data.roomId, "Bob");
  if (!joined.ok) throw new Error(joined.error);
  const started = await startGame(alice);
  if (!started.ok) throw new Error(started.error);
  return { alice, roomId: created.data.roomId };
}

beforeEach(async () => {
  useSession.getState().leave();
  server = createServer();
  url = `http://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  for (const teardown of teardowns.splice(0)) teardown();
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
  useSession.getState().leave();
});

describe("a dropped connection", () => {
  it("keeps the seat: the server sees the player back and accepts their requests", async () => {
    const { alice, roomId } = await dealtTable();
    const room = server.manager.get(roomId);

    await dropTransport(alice);

    // The seat is reclaimed asynchronously after the reconnect, so wait on the
    // server's own view of it rather than on a fixed delay.
    await vi.waitFor(() => expect(room?.seats()[0]?.connected).toBe(true));
    // Before the fix this was refused with "you are not seated in a room", while
    // the tab showed a connected table. Pausing is a request any seat may make.
    expect(await setPaused(alice, true)).toEqual({ ok: true, data: undefined });
    expect(useSession.getState().credentials?.roomId).toBe(roomId);
  });

  it("survives more than one drop", async () => {
    const { alice, roomId } = await dealtTable();
    const room = server.manager.get(roomId);

    await dropTransport(alice);
    await vi.waitFor(() => expect(room?.seats()[0]?.connected).toBe(true));
    await dropTransport(alice);
    await vi.waitFor(() => expect(room?.seats()[0]?.connected).toBe(true));

    expect(await setPaused(alice, true)).toEqual({ ok: true, data: undefined });
  });

  it("goes home with a notice when the table did not survive it", async () => {
    // A server restarted without persistence, or a room reaped while the player
    // was away: either way the token names a room that no longer exists.
    const { alice, roomId } = await dealtTable();
    const back = new Promise<void>((resolve) => alice.once("connect", () => resolve()));
    alice.io.engine.close();
    server.manager.remove(roomId);
    await back;

    await vi.waitFor(() => expect(useSession.getState().credentials).toBeNull());
    expect(useSession.getState().notice).toBe(TABLE_GONE);
    expect(useSession.getState().room).toBeNull();
  });
});
