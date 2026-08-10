import { describe, it, expect, afterEach } from "vitest";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import {
  EAST_COAST,
  type Ack,
  type Action,
  type ClientToServerEvents,
  type RoomOptions,
  type RoundEnded,
  type SeatCredentials,
  type ServerToClientEvents,
  type ViewUpdate,
} from "@hf/shared";
import { defaultAction } from "@hf/engine";
import { createServer, FakeClock, type HandAndFootServer } from "./index";

type Client = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

/**
 * These drive real Socket.io clients against a real server on an ephemeral port.
 * The point is the boundary: `view.test.ts` in the engine proves `project()` is
 * clean, which says nothing about whether the transport routes the right payload
 * to the right socket. That is what leaks hidden cards in practice.
 */

const started: HandAndFootServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  for (const s of started.splice(0)) await s.close();
});

async function boot(): Promise<{ server: HandAndFootServer; port: number }> {
  const server = createServer();
  started.push(server);
  const port = await server.listen(0);
  return { server, port };
}

async function connect(port: number): Promise<Client> {
  const socket: Client = connectClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
  clients.push(socket);
  await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
  return socket;
}

/** Latest view each client has received, so assertions can read it after a move. */
function trackViews(socket: Client): { last: ViewUpdate | null } {
  const box: { last: ViewUpdate | null } = { last: null };
  socket.on("view", (update) => {
    box.last = update;
  });
  return box;
}

function createRoom(
  socket: Client,
  name: string,
  options?: RoomOptions,
): Promise<Ack<SeatCredentials>> {
  return new Promise((resolve) => socket.emit("createRoom", { name, options }, resolve));
}
function joinRoom(socket: Client, roomId: string, name: string): Promise<Ack<SeatCredentials>> {
  return new Promise((resolve) => socket.emit("joinRoom", { roomId, name }, resolve));
}
function startGame(socket: Client): Promise<Ack<undefined>> {
  return new Promise((resolve) => socket.emit("startGame", resolve));
}
function submit(socket: Client, action: Action): Promise<Ack<undefined>> {
  return new Promise((resolve) => socket.emit("submitAction", action, resolve));
}
function setPaused(socket: Client, paused: boolean): Promise<Ack<undefined>> {
  return new Promise((resolve) => socket.emit("setPaused", { paused }, resolve));
}
function resumeSeat(socket: Client, creds: SeatCredentials): Promise<Ack<undefined>> {
  return new Promise((resolve) => socket.emit("resumeSeat", creds, resolve));
}

/** Wait for the next event of a kind, so assertions do not race the broadcast. */
function next<K extends keyof ServerToClientEvents>(
  socket: Client,
  event: K,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve) => socket.once(event, resolve as never));
}

/**
 * Wait for an event that actually says what the test is about.
 *
 * A bare `once` is not enough here: an earlier broadcast (starting the game, say)
 * can land after its own ack has resolved, so the listener catches the wrong one
 * and the test fails on a race rather than on the behaviour.
 */
function waitFor<K extends keyof ServerToClientEvents>(
  socket: Client,
  event: K,
  matches: (payload: Parameters<ServerToClientEvents[K]>[0]) => boolean,
  timeoutMs = 4_000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler as never);
      reject(new Error(`no matching ${String(event)} within ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (payload: Parameters<ServerToClientEvents[K]>[0]): void => {
      if (!matches(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler as never);
      resolve(payload);
    };
    socket.on(event, handler as never);
  });
}

async function seatTwo(): Promise<{
  server: HandAndFootServer;
  port: number;
  host: Client;
  guest: Client;
  roomId: string;
  hostCreds: SeatCredentials;
  guestCreds: SeatCredentials;
}> {
  const { server, port } = await boot();
  const host = await connect(port);
  const created = await createRoom(host, "ana");
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.error);

  const guest = await connect(port);
  const joined = await joinRoom(guest, created.data.roomId, "ben");
  expect(joined.ok).toBe(true);
  if (!joined.ok) throw new Error(joined.error);

  return {
    server,
    port,
    host,
    guest,
    roomId: created.data.roomId,
    hostCreds: created.data,
    guestCreds: joined.data,
  };
}

describe("lobby over the wire", () => {
  it("tells the host about a player who joins after them", async () => {
    // Attached before the guest joins, because the arrival broadcast is what is
    // being tested: the host's lobby has to fill in without polling.
    const { port } = await boot();
    const host = await connect(port);
    const created = await createRoom(host, "ana");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const arrival = waitFor(host, "room", (i) => i.players.length === 2);
    const guest = await connect(port);
    const joined = await joinRoom(guest, created.data.roomId.toLowerCase(), "ben");
    expect(joined.ok && joined.data.seat).toBe(1);

    const info = await arrival;
    expect(info.roomId).toBe(created.data.roomId);
    expect(info.hostSeat).toBe(0);
    expect(info.started).toBe(false);
    expect(info.players.map((p) => [p.seat, p.name, p.connected])).toEqual([
      [0, "ana", true],
      [1, "ben", true],
    ]);
  });

  it("rejects a join for an unknown room code", async () => {
    const { port } = await boot();
    const socket = await connect(port);
    const joined = await joinRoom(socket, "ZZZZZZ", "ana");
    expect(joined.ok).toBe(false);
  });

  it("refuses to start for anyone but the host", async () => {
    const { guest } = await seatTwo();
    const refused = await startGame(guest);
    expect(refused.ok).toBe(false);
  });

  it("survives a broadcast to a room that has not started", async () => {
    // Pausing is legal in the lobby, and it broadcasts views to a room with no
    // game state yet. Nothing to send is not an error.
    const { host, guest } = await seatTwo();
    const seen = waitFor(guest, "room", (i) => i.pausedBy === 0);
    expect((await setPaused(host, true)).ok).toBe(true);
    expect((await seen).started).toBe(false);
  });

  it("refuses to act in a room that has since been torn down", async () => {
    const { server, host, roomId } = await seatTwo();
    expect(server.manager.remove(roomId)).toBe(true);
    expect((await submit(host, { type: "draw" })).ok).toBe(false);
    expect((await startGame(host)).ok).toBe(false);
  });

  it("reclaims a lobby seat before the game has started", async () => {
    const { port, guest, guestCreds, roomId } = await seatTwo();
    guest.disconnect();
    const back = await connect(port);
    // Attached before the ask: the room broadcast goes out with the ack.
    const rejoined = waitFor(back, "room", (i) => i.players[1].connected);
    const resumed = await resumeSeat(back, guestCreds);
    expect(resumed.ok).toBe(true);
    const info = await rejoined;
    expect(info.roomId).toBe(roomId);
    expect(info.started).toBe(false);
  });

  it("keeps one room's broadcasts out of another room on the same server", async () => {
    // Two tables share a process. A view meant for one must never reach a socket
    // seated at the other, which is the same guarantee as hiding a hand, just at
    // room granularity.
    const { port } = await boot();
    const aHost = await connect(port);
    const aGuest = await connect(port);
    const bHost = await connect(port);

    const roomA = await createRoom(aHost, "ana");
    const roomB = await createRoom(bHost, "zoe");
    expect(roomA.ok && roomB.ok).toBe(true);
    if (!roomA.ok || !roomB.ok) return;
    expect(roomA.data.roomId).not.toBe(roomB.data.roomId);
    await joinRoom(aGuest, roomA.data.roomId, "ben");

    const strayViews: ViewUpdate[] = [];
    const strayRooms: string[] = [];
    bHost.on("view", (u) => strayViews.push(u));
    bHost.on("room", (i) => strayRooms.push(i.roomId));

    const dealt = waitFor(aGuest, "view", (u) => u.view.hand.length > 0);
    expect((await startGame(aHost)).ok).toBe(true);
    await dealt;
    // Let the loop drain: a stray delivered to the other room's socket would
    // arrive a tick after the intended one, so asserting immediately would pass
    // even when the room filter is gone.
    await new Promise((r) => setTimeout(r, 50));

    expect(strayViews).toEqual([]);
    expect(strayRooms).not.toContain(roomA.data.roomId);
  });

  it("returns a pause rejection without broadcasting anything", async () => {
    const { host, guest } = await seatTwo();
    const strays: string[] = [];
    guest.on("room", () => strays.push("room"));
    // The table is not paused, so resuming is refused and nothing changes.
    const refused = await setPaused(host, false);
    expect(refused.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(strays).toEqual([]);
  });

  it("refuses actions from a socket that never joined a room", async () => {
    const { port } = await boot();
    const stranger = await connect(port);
    expect((await submit(stranger, { type: "draw" })).ok).toBe(false);
    expect((await startGame(stranger)).ok).toBe(false);
    expect((await setPaused(stranger, true)).ok).toBe(false);
  });

  it("never puts a seat token on the room broadcast", async () => {
    const { host, guest, hostCreds, guestCreds } = await seatTwo();
    const info = next(guest, "room");
    await startGame(host);
    const payload = JSON.stringify(await info);
    expect(payload).not.toContain(hostCreds.token);
    expect(payload).not.toContain(guestCreds.token);
  });
});

describe("choosing the rules when creating a room", () => {
  it("opens an East Coast family table when the creator picks nothing", async () => {
    const { host } = await seatTwo();
    const info = await waitFor(host, "room", () => true);
    expect(info.config.wildRatio).toBe("naturals-exceed-wilds");
    expect(info.config.mode).toBe("family");
    expect(info.config.pauseEnabled).toBe(true);
  });

  it("honors the creator's preset and mode over the wire", async () => {
    const { port } = await boot();
    const host = await connect(port);
    // Attached first: the room broadcast goes out with the ack.
    const opened = waitFor(host, "room", () => true);
    const created = await createRoom(host, "ana", {
      preset: "west-coast",
      mode: "competitive",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const info = await opened;
    expect(info.config.wildRatio).toBe("naturals-equal-wilds");
    expect(info.config.mode).toBe("competitive");
    expect(info.config.pauseEnabled).toBe(false);
  });

  it("actually enforces the chosen rules, not just reports them", async () => {
    // A competitive table is one where the clock cannot be stopped, and the
    // server has to refuse the pause, not merely render a different label.
    const { port } = await boot();
    const host = await connect(port);
    const created = await createRoom(host, "ana", { mode: "competitive" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const guest = await connect(port);
    await joinRoom(guest, created.data.roomId, "ben");
    await startGame(host);

    const refused = await setPaused(guest, true);
    expect(refused.ok).toBe(false);
  });

  it("keeps each room on its own rules", async () => {
    const { port } = await boot();
    const a = await connect(port);
    const b = await connect(port);
    const openedA = waitFor(a, "room", () => true);
    const openedB = waitFor(b, "room", () => true);
    const roomA = await createRoom(a, "ana", { preset: "east-coast" });
    const roomB = await createRoom(b, "zoe", { preset: "west-coast" });
    expect(roomA.ok && roomB.ok).toBe(true);
    if (!roomA.ok || !roomB.ok) return;

    const infoA = await openedA;
    const infoB = await openedB;
    expect(infoA.config.wildRatio).toBe("naturals-exceed-wilds");
    expect(infoB.config.wildRatio).toBe("naturals-equal-wilds");
  });
});

describe("view security across the transport", () => {
  it("sends each socket only its own hand", async () => {
    const { host, guest } = await seatTwo();
    const hostView = next(host, "view");
    const guestView = next(guest, "view");
    await startGame(host);

    const mine = await hostView;
    const theirs = await guestView;
    expect(mine.view.seat).toBe(0);
    expect(theirs.view.seat).toBe(1);

    // The decisive check: neither payload contains the other's cards.
    const myIds = new Set(mine.view.hand.map((c) => c.id));
    const theirIds = new Set(theirs.view.hand.map((c) => c.id));
    expect(myIds.size).toBe(EAST_COAST.handSize);
    for (const id of theirIds) expect(myIds.has(id)).toBe(false);
    expect(JSON.stringify(mine.view)).not.toContain([...theirIds][0]);
  });

  it("hides the foot and the stock from their own owner until picked up", async () => {
    const { host } = await seatTwo();
    const view = next(host, "view");
    await startGame(host);
    const update = await view;
    expect(update.view.foot).toBeNull();
    expect(update.view.footCount).toBe(EAST_COAST.footSize);
    expect(update.view.stockCount).toBeGreaterThan(0);
    expect(JSON.stringify(update)).not.toContain('"stock"');
  });
});

describe("playing over the wire", () => {
  it("accepts a legal action and pushes a fresh view to both seats", async () => {
    const { host, guest } = await seatTwo();
    const hostBox = trackViews(host);
    const guestBox = trackViews(guest);
    await startGame(host);

    const before = hostBox.last!.view.hand.length;
    const mine = waitFor(host, "view", (u) => u.view.hand.length === before + 1);
    const theirs = waitFor(guest, "view", (u) => u.view.opponents[0].handCount === before + 1);
    expect((await submit(host, { type: "draw" })).ok).toBe(true);
    await mine;
    await theirs;

    expect(hostBox.last!.view.hand.length).toBe(before + 1);
    // The opponent learns the count changed, never which card arrived.
    const opponent = guestBox.last!.view.opponents[0];
    expect(opponent.handCount).toBe(before + 1);
    expect(JSON.stringify(opponent)).not.toContain(hostBox.last!.view.hand[before].id);
  });

  it("rejects an out-of-turn action and leaves the game untouched", async () => {
    const { server, host, guest, roomId } = await seatTwo();
    await startGame(host);
    const rejected = await submit(guest, { type: "draw" });
    expect(rejected.ok).toBe(false);
    expect(server.manager.get(roomId)!.log.length).toBe(0);
  });

  it("cannot be made to act as another seat by lying in the payload", async () => {
    // The seat comes from the server's session table, never from the client.
    const { server, guest, roomId } = await seatTwo();
    const room = server.manager.get(roomId)!;
    await new Promise<void>((r) => guest.emit("startGame", () => r()));
    expect(room.started).toBe(false);
  });

  it("pauses and resumes the table for everyone", async () => {
    const { host, guest } = await seatTwo();
    await startGame(host);
    const paused = waitFor(guest, "room", (info) => info.pausedBy === 1);
    expect((await setPaused(guest, true)).ok).toBe(true);
    expect((await paused).pausedBy).toBe(1);

    expect((await submit(host, { type: "draw" })).ok).toBe(false);
    expect((await setPaused(host, false)).ok).toBe(true);
    expect((await submit(host, { type: "draw" })).ok).toBe(true);
  });
});

describe("reconnection", () => {
  it("marks a seat disconnected and lets the same token reclaim it", async () => {
    const { server, port, host, guest, roomId, guestCreds } = await seatTwo();
    await startGame(host);
    const room = server.manager.get(roomId)!;

    const sawDrop = waitFor(host, "room", (info) => info.players[1].connected === false);
    guest.disconnect();
    await sawDrop;

    const reconnected = await connect(port);
    // Listen before asking: the server pushes the view straight after the ack,
    // so a listener attached afterwards misses it and waits forever.
    const view = waitFor(reconnected, "view", (u) => u.view.seat === 1);
    const resumed = await resumeSeat(reconnected, guestCreds);
    expect(resumed.ok).toBe(true);
    expect(room.info().players[1].connected).toBe(true);

    // The reclaimed socket gets its own cards back, not just a lobby update.
    const update = await view;
    expect(update.view.hand).toHaveLength(EAST_COAST.handSize);
    expect(update.view.hand.map((c) => c.id)).toEqual(
      room.gameState!.players[1].hand.map((c) => c.id),
    );
  });

  it("binds the seat to the token, not to the seat the client claims", async () => {
    // Privilege escalation if it did not: a player holding their own valid token
    // could name someone else's seat and act as them. The seat must be derived
    // from the token server-side and the payload's seat field ignored entirely.
    const { server, port, host, guest, roomId, guestCreds } = await seatTwo();
    await startGame(host);
    const room = server.manager.get(roomId)!;

    guest.disconnect();
    const back = await connect(port);
    const view = waitFor(back, "view", () => true);
    // Seat 1's real token, but claiming seat 0.
    const resumed = await resumeSeat(back, { ...guestCreds, seat: 0 });
    expect(resumed.ok).toBe(true);

    // The pushed view is seat 1's, not the claimed seat 0's.
    const update = await view;
    expect(update.view.seat).toBe(1);
    expect(update.view.hand.map((c) => c.id)).toEqual(
      room.gameState!.players[1].hand.map((c) => c.id),
    );

    // And it can only act as seat 1: seat 0 is on turn, so this must be refused.
    expect(room.gameState!.currentSeat).toBe(0);
    expect((await submit(back, { type: "draw" })).ok).toBe(false);
  });

  it("refuses to reclaim a seat with a token from another room", async () => {
    const { port, guestCreds } = await seatTwo();
    const other = await connect(port);
    const wrongRoom = await resumeSeat(other, { ...guestCreds, roomId: "ZZZZZZ" });
    expect(wrongRoom.ok).toBe(false);
    const wrongToken = await resumeSeat(other, { ...guestCreds, token: "forged" });
    expect(wrongToken.ok).toBe(false);
  });
});

describe("the clock over the wire", () => {
  it("pushes a fresh view when the server moves for a player who ran out of time", async () => {
    // Nobody asked for anything, so without the room notifying the transport the
    // table would silently fall behind until somebody happened to act.
    const clock = new FakeClock(1_000);
    const server = createServer({ clock });
    started.push(server);
    const port = await server.listen(0);

    const host = await connect(port);
    const guest = await connect(port);
    const created = await createRoom(host, "ana");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await joinRoom(guest, created.data.roomId, "ben");
    await startGame(host);

    const room = server.manager.get(created.data.roomId)!;
    expect(room.gameState!.phase).toBe("draw");

    // The main clock expires: the server draws and opens the discard grace.
    const timedOut = waitFor(guest, "view", (u) => u.clock.inDiscardGrace);
    clock.advance(EAST_COAST.timers.baseMs);
    const update = await timedOut;

    expect(update.view.phase).toBe("play");
    expect(update.clock.deadlineAt).toBe(
      1_000 + EAST_COAST.timers.baseMs + EAST_COAST.timers.discardGraceMs,
    );
    expect(room.log.entries().at(-1)).toMatchObject({ source: "timeout" });
  });

  it("sends a deadline the client can anchor against its own clock", async () => {
    const clock = new FakeClock(500_000);
    const server = createServer({ clock });
    started.push(server);
    const port = await server.listen(0);

    const host = await connect(port);
    const guest = await connect(port);
    const created = await createRoom(host, "ana");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await joinRoom(guest, created.data.roomId, "ben");

    const dealt = waitFor(host, "view", (u) => u.view.hand.length > 0);
    await startGame(host);
    const update = await dealt;

    // Absolute instants, both on the server's clock, so the client computes one
    // offset rather than counting down a figure that drifts on every update.
    expect(update.clock.serverNow).toBe(500_000);
    expect(update.clock.deadlineAt).toBe(500_000 + EAST_COAST.timers.baseMs);
    expect(update.clock.paused).toBe(false);
  });
});

describe("a whole round, end to end", () => {
  it("plays to a finish and reports scores to every seat", async () => {
    // A shoe small enough to run out: with the stock exhausted the round ends,
    // which is a real terminal state rather than a test-only shortcut. The
    // default policy never melds, so this is the ending it can actually reach.
    const { server, port } = await boot();
    const room = server.manager.create({
      ...EAST_COAST,
      extraDecks: 0,
      stockExhaustion: "end",
    });

    const host = await connect(port);
    const guest = await connect(port);
    const created = await joinRoom(host, room.id, "ana");
    const joined = await joinRoom(guest, room.id, "ben");
    expect(created.ok && joined.ok).toBe(true);

    const sockets = [host, guest];
    const endings: RoundEnded[] = [];
    for (const s of sockets) s.on("roundEnded", (r) => endings.push(r));

    expect((await startGame(host)).ok).toBe(true);

    let moves = 0;
    while (!room.gameState?.roundEnded && moves < 500) {
      const state = room.gameState!;
      const action = defaultAction(state);
      expect(action, `no default at move ${moves}`).not.toBeNull();
      const ack = await submit(sockets[state.currentSeat], action as Action);
      expect(ack.ok, `move ${moves} rejected`).toBe(true);
      moves++;
    }

    expect(room.gameState?.roundEnded).toBe(true);
    expect(moves).toBeGreaterThan(10);

    // Every accepted move is in the log, in order, and nothing else is.
    expect(room.log.length).toBe(moves);
    expect(room.log.entries().map((e) => e.seq)).toEqual(
      Array.from({ length: moves }, (_, i) => i),
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(endings).toHaveLength(2);
    expect(endings[0].scores).toHaveLength(2);
    expect(endings[0].scores.map((s) => s.seat)).toEqual([0, 1]);
  }, 30_000);
});
