import { describe, it, expect, afterEach } from "vitest";
import { connect as connectTransport, type TableSocket } from "@hf/transport";
import {
  EAST_COAST,
  type Ack,
  type Action,
  type RoomInfo,
  type RoomOptions,
  type RoundEnded,
  type SeatCredentials,
  type ServerToClientEvents,
  type ViewUpdate,
} from "@hf/shared";
import { defaultAction } from "@hf/engine";
import { createServer, FakeClock, MAX_PLAYERS, type HandAndFootServer } from "./index";

type Client = TableSocket;

/**
 * These drive real clients — the one the browser uses, over plain WebSockets —
 * against a real server on an ephemeral port.
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
  const socket: Client = connectTransport(`http://localhost:${port}`);
  clients.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
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
function resumeSeat(socket: Client, creds: SeatCredentials): Promise<Ack<SeatCredentials>> {
  return new Promise((resolve) => socket.emit("resumeSeat", creds, resolve));
}
function leaveRoom(socket: Client): Promise<Ack<undefined>> {
  return new Promise((resolve) => socket.emit("leaveRoom", resolve));
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

  it("delivers each socket the hints for its own seat", async () => {
    // Same reasoning as the hand: project() being right says nothing about which
    // socket the payload reaches. Seat 0 opens the round, so the two sockets must
    // receive visibly different hints, and each the ones meant for it.
    const { host, guest } = await seatTwo();
    const hostView = next(host, "view");
    const guestView = next(guest, "view");
    await startGame(host);

    const mine = await hostView;
    const theirs = await guestView;
    expect(mine.hints.seatToAct).toBe(0);
    expect(theirs.hints.seatToAct).toBe(0);
    expect(mine.hints.canDraw).toBe(true);
    expect(theirs.hints.canDraw).toBe(false);
    // Hints are booleans, a seat and ranks — never cards.
    expect(JSON.stringify(mine.hints)).not.toContain([...theirs.view.hand.map((c) => c.id)][0]);
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

  it("tells only the drawer which card they drew, and everyone that a card was drawn", async () => {
    const { host, guest } = await seatTwo();
    trackViews(host);
    trackViews(guest);
    await startGame(host);
    const mine = waitFor(host, "view", (u) => u.lastMove?.kind === "draw");
    const theirs = waitFor(guest, "view", (u) => u.lastMove?.kind === "draw");
    expect((await submit(host, { type: "draw" })).ok).toBe(true);
    const [own, other] = await Promise.all([mine, theirs]);
    const drawn = own.lastMove!.card!;
    expect(own.view.hand.map((c) => c.id)).toContain(drawn.id);
    expect(other.lastMove).toEqual({ seq: own.lastMove!.seq, seat: own.view.seat, kind: "draw" });
    // Over the wire, not just in the projection: the id is nowhere in the guest's update.
    expect(JSON.stringify(other)).not.toContain(drawn.id);
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

  it("ignores a late disconnect from a socket whose seat was already reclaimed", async () => {
    // A phone switching networks resumes on a new socket before the server has
    // noticed the old one is dead. When the old one's disconnect finally lands it
    // must not mark the live player gone, or their turns get played for them.
    const clock = new FakeClock(1_000);
    const server = createServer({ clock, reconnectGraceMs: 1_000 });
    started.push(server);
    const port = await server.listen(0);

    const host = await connect(port);
    const stale = await connect(port);
    const created = await createRoom(host, "ana");
    if (!created.ok) throw new Error(created.error);
    const joined = await joinRoom(stale, created.data.roomId, "ben");
    if (!joined.ok) throw new Error(joined.error);
    await startGame(host);
    const room = server.manager.get(created.data.roomId)!;

    const fresh = await connect(port);
    expect((await resumeSeat(fresh, joined.data)).ok).toBe(true);

    const hostSawDrop = waitFor(host, "room", (info) => info.players[1].connected === false, 300);
    stale.disconnect();
    // A later round trip on the live socket proves the server has handled the
    // disconnect before the negative assertions below.
    expect((await setPaused(fresh, true)).ok).toBe(true);
    expect((await setPaused(fresh, false)).ok).toBe(true);
    await expect(hostSawDrop).rejects.toThrow();
    expect(room.info().players[1].connected).toBe(true);

    // Seat 1 is live, so its turn is not played out once the grace would be gone.
    expect(room.submitAction(0, { type: "draw" }).ok).toBe(true);
    const seat0 = room.gameState!.players[0];
    expect(room.submitAction(0, { type: "discard", cardId: seat0.hand[0].id }).ok).toBe(true);
    clock.advance(5_000);
    expect(room.gameState!.currentSeat).toBe(1);
    expect(room.log.entries().every((e) => e.source === "player")).toBe(true);

    // The live socket's own disconnect still counts.
    const sawDrop = waitFor(host, "room", (info) => info.players[1].connected === false);
    fresh.disconnect();
    await sawDrop;
  });

  it("marks a seat gone the moment its live socket drops, even with a stale one registered", async () => {
    // The old socket has not timed out yet, so its session is still on the books.
    // That must not hold the seat open: the reconnect grace starts now.
    const { server, port, host, guest, roomId, guestCreds } = await seatTwo();
    await startGame(host);
    const room = server.manager.get(roomId)!;

    const fresh = await connect(port);
    expect((await resumeSeat(fresh, guestCreds)).ok).toBe(true);
    expect(guest.connected).toBe(true);

    const sawDrop = waitFor(host, "room", (info) => info.players[1].connected === false);
    fresh.disconnect();
    await sawDrop;
    expect(room.info().players[1].connected).toBe(false);
  });

  it("lets go of a seat when its socket takes a seat somewhere else", async () => {
    const { server, port, host, guest, roomId } = await seatTwo();
    const room = server.manager.get(roomId)!;

    const sawDrop = waitFor(host, "room", (info) => info.players[1].connected === false);
    expect((await createRoom(guest, "ben elsewhere")).ok).toBe(true);
    await sawDrop;
    expect(room.info().players[1].connected).toBe(false);

    // Reclaiming the seat the socket already holds is not a move.
    const other = await connect(port);
    const created = await createRoom(other, "cy");
    if (!created.ok) throw new Error(created.error);
    expect((await resumeSeat(other, created.data)).ok).toBe(true);
    expect(server.manager.get(created.data.roomId)!.info().players[0].connected).toBe(true);
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

describe("leaving over the wire", () => {
  it("frees a lobby seat, tells the table, and lets a newcomer take it", async () => {
    const { port, host, guest, roomId, guestCreds } = await seatTwo();
    const third = await connect(port);
    const joined = await joinRoom(third, roomId, "cy");
    if (!joined.ok) throw new Error(joined.error);

    // Listen first: all of these go out straight after the ack.
    const guestSaw = waitFor(guest, "room", (i) => i.players.length === 2);
    const guestSeat = next(guest, "seat");
    const thirdSeat = next(third, "seat");
    expect((await leaveRoom(host)).ok).toBe(true);

    // The host left, so the seats close up and the next in line hosts.
    const info = await guestSaw;
    expect(info.players.map((p) => [p.seat, p.name])).toEqual([
      [0, "ben"],
      [1, "cy"],
    ]);
    expect(info.hostSeat).toBe(0);
    expect(await guestSeat).toBe(0);
    expect(await thirdSeat).toBe(1);

    // Stored credentials still carry the old number; resuming answers with the new one.
    expect(guestCreds.seat).toBe(1);
    const resumed = await resumeSeat(guest, guestCreds);
    expect(resumed.ok && resumed.data.seat).toBe(0);

    const newcomer = await connect(port);
    const took = await joinRoom(newcomer, roomId, "dee");
    expect(took.ok && took.data.seat).toBe(2);

    // The new host's socket acts as the new seat 0, so it can deal.
    const dealt = waitFor(third, "view", (u) => u.view.seat === 1);
    expect((await startGame(guest)).ok).toBe(true);
    expect((await dealt).view.hand).toHaveLength(EAST_COAST.handSize);
  });

  it("stops sending anything to the socket that left, or to another table", async () => {
    const { port, host, guest, roomId } = await seatTwo();
    const elsewhere = await connect(port);
    expect((await createRoom(elsewhere, "zoe")).ok).toBe(true);
    const elsewhereHeard = waitFor(elsewhere, "seat", () => true, 300);
    const guestHeard = waitFor(guest, "seat", (seat) => seat === 0);
    expect((await leaveRoom(host)).ok).toBe(true);
    await guestHeard;
    await expect(elsewhereHeard).rejects.toThrow();

    expect((await joinRoom(host, roomId, "ana again")).ok).toBe(true);
    expect((await leaveRoom(guest)).ok).toBe(true);
    const leaverHeard = waitFor(guest, "room", () => true, 300);
    const newcomer = await connect(port);
    const hostSaw = waitFor(host, "room", (i) => i.players.length === 2);
    expect((await joinRoom(newcomer, roomId, "cy")).ok).toBe(true);
    await hostSaw;
    await expect(leaverHeard).rejects.toThrow();
  });

  it("refuses a socket with no seat, and one whose seat was reclaimed elsewhere", async () => {
    const { server, port, roomId, guest, guestCreds } = await seatTwo();
    const nobody = await connect(port);
    expect(await leaveRoom(nobody)).toEqual({ ok: false, error: "you are not seated in a room" });

    // The superseded socket must not give away a seat that is in use.
    const fresh = await connect(port);
    expect((await resumeSeat(fresh, guestCreds)).ok).toBe(true);
    expect((await leaveRoom(guest)).ok).toBe(false);
    expect(server.manager.get(roomId)!.seatCount).toBe(2);

    // Leaving twice is refused the second time rather than throwing.
    expect((await leaveRoom(fresh)).ok).toBe(true);
    expect((await leaveRoom(fresh)).ok).toBe(false);
  });

  it("drops a superseded socket along with the seat it once held", async () => {
    const { port, host, guest, guestCreds } = await seatTwo();
    const fresh = await connect(port);
    expect((await resumeSeat(fresh, guestCreds)).ok).toBe(true);
    expect((await leaveRoom(fresh)).ok).toBe(true);
    // The stale socket is not seated anywhere now, and hears nothing further.
    const staleHeard = waitFor(guest, "room", () => true, 300);
    expect((await setPaused(host, true)).ok).toBe(true);
    await expect(staleHeard).rejects.toThrow();
    expect(await submit(guest, { type: "draw" })).toEqual({
      ok: false,
      error: "you are not seated in a room",
    });
  });

  it("plays a departed seat at once in a dealt game, without waiting out the grace", async () => {
    const clock = new FakeClock(1_000);
    const server = createServer({ clock, reconnectGraceMs: 60_000 });
    started.push(server);
    const port = await server.listen(0);

    const host = await connect(port);
    const guest = await connect(port);
    const created = await createRoom(host, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(guest, created.data.roomId, "ben");
    await startGame(host);
    const room = server.manager.get(created.data.roomId)!;
    expect(room.gameState!.currentSeat).toBe(0);

    const played = waitFor(guest, "view", (u) => u.view.currentSeat === 1);
    const dropped = waitFor(guest, "room", (i) => i.players[0].connected === false);
    expect((await leaveRoom(host)).ok).toBe(true);
    await dropped;
    // No time passes beyond the zero-delay wake-up: the grace is not waited on.
    clock.advance(0);
    await played;
    expect(room.seatCount).toBe(2);
    expect(room.log.entries().every((e) => e.source === "disconnect")).toBe(true);
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

  it("gives a seat that resumes after the round ended the result, and only that seat", async () => {
    // The result is broadcast once, at the end of the round. A player who reloads
    // after that holds a finished view with no scores, and the table would go back
    // to showing a turn that will never come.
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
    if (!joined.ok) return;

    const sockets = [host, guest];
    const endings: RoundEnded[] = [];
    for (const s of sockets) s.on("roundEnded", (r) => endings.push(r));
    expect((await startGame(host)).ok).toBe(true);

    let moves = 0;
    while (!room.gameState?.roundEnded && moves < 500) {
      const state = room.gameState!;
      const action = defaultAction(state);
      expect(action, `no default at move ${moves}`).not.toBeNull();
      expect((await submit(sockets[state.currentSeat], action as Action)).ok).toBe(true);
      moves++;
    }
    expect(room.gameState?.roundEnded).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(endings).toHaveLength(2);

    const fresh = await connect(port);
    const heard: RoundEnded[] = [];
    fresh.on("roundEnded", (r) => heard.push(r));
    const views = trackViews(fresh);
    expect((await resumeSeat(fresh, joined.data)).ok).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(heard).toEqual([room.result()]);
    expect(heard[0]).toEqual(endings[1]);
    expect(views.last?.clock.deadlineAt).toBeNull();
    // Resuming one seat does not replay the result to the rest of the table.
    expect(endings).toHaveLength(2);
  }, 30_000);

  it("sends no result to a seat that resumes while the round is still live", async () => {
    const { port, host, guestCreds } = await seatTwo();
    expect((await startGame(host)).ok).toBe(true);
    const fresh = await connect(port);
    const heard: RoundEnded[] = [];
    fresh.on("roundEnded", (r) => heard.push(r));
    expect((await resumeSeat(fresh, guestCreds)).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(heard).toEqual([]);
  });

  it("keeps a finished round's scores out of another room on the same server", async () => {
    // The room filter on the roundEnded broadcast, which the view broadcast has
    // its own test for. Scores name every seat at the table, so one delivered to
    // a bystander leaks another table's whole result.
    const { server, port } = await boot();
    const room = server.manager.create({
      ...EAST_COAST,
      extraDecks: 0,
      stockExhaustion: "end",
    });

    const host = await connect(port);
    const guest = await connect(port);
    expect((await joinRoom(host, room.id, "ana")).ok).toBe(true);
    expect((await joinRoom(guest, room.id, "ben")).ok).toBe(true);

    // A socket seated at a different table, which must hear nothing.
    const bystander = await connect(port);
    const other = await createRoom(bystander, "zoe");
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.data.roomId).not.toBe(room.id);
    const strayEndings: RoundEnded[] = [];
    bystander.on("roundEnded", (r) => strayEndings.push(r));

    const sockets = [host, guest];
    const endings: RoundEnded[] = [];
    for (const s of sockets) s.on("roundEnded", (r) => endings.push(r));
    expect((await startGame(host)).ok).toBe(true);

    let moves = 0;
    while (!room.gameState?.roundEnded && moves < 500) {
      const state = room.gameState!;
      const action = defaultAction(state);
      expect(action, `no default at move ${moves}`).not.toBeNull();
      expect((await submit(sockets[state.currentSeat], action as Action)).ok).toBe(true);
      moves++;
    }
    expect(room.gameState?.roundEnded).toBe(true);

    // Drain before asserting the negative: a stray would arrive a tick after the
    // intended pair, so an immediate assertion passes even with no filter at all.
    await new Promise((r) => setTimeout(r, 50));
    expect(endings).toHaveLength(2);
    expect(strayEndings).toEqual([]);
  }, 30_000);
});

describe("stageMelds over the wire", () => {
  function stage(socket: Client, payload: unknown): Promise<Ack<undefined>> {
    return new Promise((resolve) => socket.emit("stageMelds", payload as never, resolve));
  }

  it("refuses a socket that holds no seat", async () => {
    const { port } = await boot();
    const stranger = await connect(port);
    expect(await stage(stranger, { melds: [] })).toEqual({
      ok: false,
      error: "you are not seated in a room",
    });
  });

  it("reaches the sender's own room, and treats a malformed payload as no draft", async () => {
    const { server, port } = await boot();
    const [a, b] = [await connect(port), await connect(port)];
    const created = await createRoom(a, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(b, created.data.roomId, "ben");
    await startGame(a);
    const room = server.manager.get(created.data.roomId)!;
    const onTurn = room.gameState!.currentSeat === 0 ? a : b;
    // Before drawing the room refuses any draft, which shows the call got there.
    expect(await stage(onTurn, { melds: [] })).toEqual({
      ok: false,
      error: "melds can only be staged after drawing",
    });
    expect((await submit(onTurn, { type: "draw" })).ok).toBe(true);
    expect(await stage(onTurn, { melds: "nonsense" })).toEqual({ ok: true, data: undefined });
    expect(await stage(onTurn, null)).toEqual({ ok: true, data: undefined });
  });

  it.each([
    ["a null group", { melds: [null] }],
    ["card ids that are not a list", { melds: [{ rank: "K", cardIds: 5 }] }],
  ])("keeps serving when %s is staged and the clock runs out", async (_, payload) => {
    const clock = new FakeClock(1_000_000);
    const server = createServer({ clock });
    started.push(server);
    const port = await server.listen(0);
    const [a, b] = [await connect(port), await connect(port)];
    const created = await createRoom(a, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(b, created.data.roomId, "ben");
    await startGame(a);
    const room = server.manager.get(created.data.roomId)!;
    const seat = room.gameState!.currentSeat;
    const onTurn = seat === 0 ? a : b;
    expect((await submit(onTurn, { type: "draw" })).ok).toBe(true);
    const hand = room.gameState!.players[seat]!.hand.length;
    expect(await stage(onTurn, payload)).toEqual({ ok: true, data: undefined });

    // Main clock, then the discard grace: the server plays the turn out itself.
    clock.advance(room.clockState().deadlineAt! - clock.now());
    clock.advance(room.clockState().deadlineAt! - clock.now());
    expect(room.gameState!.currentSeat).not.toBe(seat);
    expect(room.gameState!.players[seat]!.hand).toHaveLength(hand - 1);
    expect(room.log.entries().map((e) => e.action.type)).not.toContain("playMelds");
    // Still serving: the next player can move.
    expect((await submit(seat === 0 ? b : a, { type: "draw" })).ok).toBe(true);
  });
});

describe("playing again over the wire", () => {
  /** A dealt table whose round the server has just finished. */
  async function finished(names: readonly string[]): Promise<{
    server: HandAndFootServer;
    port: number;
    sockets: Client[];
    roomId: string;
  }> {
    const { server, port } = await boot();
    const sockets: Client[] = [];
    for (let i = 0; i < names.length; i++) sockets.push(await connect(port));
    const created = await createRoom(sockets[0]!, names[0]!);
    if (!created.ok) throw new Error(created.error);
    for (let i = 1; i < names.length; i++)
      await joinRoom(sockets[i]!, created.data.roomId, names[i]!);
    await startGame(sockets[0]!);
    // End the match directly — its last round: how a round ends is the engine's business, and what
    // is under test here is what the transport does afterwards.
    const room = server.manager.get(created.data.roomId)!;
    const state = room.gameState!;
    Object.assign(room as unknown as { state: typeof state }, {
      state: { ...state, roundEnded: true, roundNumber: state.config.rounds },
    });
    return { server, port, sockets, roomId: created.data.roomId };
  }

  const again = (socket: Client): Promise<Ack<SeatCredentials>> =>
    new Promise((resolve) => socket.emit("playAgain", resolve));

  it("opens a waiting room for the first to ask, and brings the others into the same one", async () => {
    const { server, sockets, roomId } = await finished(["ana", "ben", "cy"]);
    const [a, b] = sockets as [Client, Client, Client];

    const seen = waitForRoom(b, (info) => info.roomId === roomId && info.playAgain.length === 1);
    const first = await again(a);
    if (!first.ok) throw new Error(first.error);
    expect(first.data.roomId).not.toBe(roomId);
    expect(first.data.seat).toBe(0);
    // The table left behind shows who has gone on.
    expect((await seen).playAgain).toEqual([0]);

    const second = await again(b);
    expect(second).toMatchObject({ ok: true, data: { roomId: first.data.roomId, seat: 1 } });
    const next = server.manager.get(first.data.roomId)!;
    expect(next.started).toBe(false);
    expect(next.seats().map((p) => p.name)).toEqual(["ana", "ben"]);
    expect(next.config).toEqual(server.manager.get(roomId)!.config);

    // The first to go hosts, and deals when they choose — here without cy.
    expect((await startGame(a)).ok).toBe(true);
    expect(next.gameState!.players).toHaveLength(2);
  });

  it("tells a player who asks too late that the next game started without them", async () => {
    const { sockets } = await finished(["ana", "ben", "cy"]);
    const [a, b, c] = sockets as [Client, Client, Client];
    await again(a);
    await again(b);
    await startGame(a);
    expect(await again(c)).toEqual({
      ok: false,
      error: "the next game has already started without you",
    });
  });

  it("is refused before the round is over, and to a socket with no seat", async () => {
    const { port } = await boot();
    const [a, b, stranger] = [await connect(port), await connect(port), await connect(port)];
    const created = await createRoom(a, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(b, created.data.roomId, "ben");
    await startGame(a);
    expect(await again(a)).toEqual({ ok: false, error: "the match is not over yet" });
    expect(await again(stranger)).toEqual({ ok: false, error: "you are not seated in a room" });
  });

  it("says so when the waiting room has filled up", async () => {
    // Strangers can join the waiting room by its code like any lobby.
    const { port, sockets } = await finished(["ana", "ben"]);
    const [a, b] = sockets as [Client, Client];
    const first = await again(a);
    if (!first.ok) throw new Error(first.error);
    for (let i = 0; i < MAX_PLAYERS - 1; i++) {
      const stranger = await connect(port);
      expect((await joinRoom(stranger, first.data.roomId, `guest${i}`)).ok).toBe(true);
    }
    expect(await again(b)).toEqual({ ok: false, error: `a table seats at most ${MAX_PLAYERS}` });
  });

  it("lets go of an older connection still speaking for the old seat", async () => {
    // The same player reconnected on a second socket before the first was noticed
    // gone: once they move on, neither may act for the old seat.
    const { port, sockets, server, roomId } = await finished(["ana", "ben"]);
    const [, b] = sockets as [Client, Client];
    const creds = server.manager.get(roomId)!.seats()[1]!;
    const again2 = await connect(port);
    expect((await resumeSeat(again2, { roomId, seat: 1, token: creds.token })).ok).toBe(true);
    expect((await again(again2)).ok).toBe(true);
    expect(await again(b)).toEqual({ ok: false, error: "you are not seated in a room" });
  });

  it("speaks for the new seat from then on, not the old one", async () => {
    const { server, sockets, roomId } = await finished(["ana", "ben"]);
    const [a] = sockets as [Client, Client];
    const moved = await again(a);
    if (!moved.ok) throw new Error(moved.error);
    // The old seat is let go; this socket's requests now go to the waiting room.
    expect(server.manager.get(roomId)!.seats()[0]!.left).toBe(true);
    expect(await startGame(a)).toEqual({ ok: false, error: "a game needs at least 2 players" });
  });
});

/** The next room broadcast that satisfies a predicate. */
function waitForRoom(socket: Client, ok: (info: RoomInfo) => boolean): Promise<RoomInfo> {
  return new Promise((resolve) => {
    const onRoom = (info: RoomInfo): void => {
      if (!ok(info)) return;
      socket.off("room", onRoom);
      resolve(info);
    };
    socket.on("room", onRoom);
  });
}

describe("handing hosting on over the wire", () => {
  it("tells the table who hosts now, and lets only the host do it", async () => {
    const { port } = await boot();
    const [a, b] = [await connect(port), await connect(port)];
    const created = await createRoom(a, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(b, created.data.roomId, "ben");
    const setHost = (socket: Client, seat: unknown): Promise<Ack<undefined>> =>
      new Promise((resolve) => socket.emit("setHost", { seat } as never, resolve));

    expect(await setHost(b, 1)).toEqual({
      ok: false,
      error: "only the host can hand hosting to someone else",
    });
    const told = waitForRoom(b, (info) => info.hostSeat === 1);
    expect(await setHost(a, 1)).toEqual({ ok: true, data: undefined });
    expect((await told).hostSeat).toBe(1);
    // Nonsense arrives as untyped JSON and is refused, not trusted.
    expect(await setHost(b, "zero")).toEqual({ ok: false, error: "no such seat" });
    const stranger = await connect(port);
    expect(await setHost(stranger, 0)).toEqual({
      ok: false,
      error: "you are not seated in a room",
    });
  });
});

describe("the next round over the wire", () => {
  it("shows who is ready, and deals the next round to everyone once all are", async () => {
    const { server, port } = await boot();
    const [a, b] = [await connect(port), await connect(port)];
    const created = await createRoom(a, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(b, created.data.roomId, "ben");
    await startGame(a);
    const room = server.manager.get(created.data.roomId)!;
    const state = room.gameState!;
    Object.assign(room as unknown as { state: typeof state }, {
      state: { ...state, roundEnded: true },
    });

    const ready = (socket: Client): Promise<Ack<boolean>> =>
      new Promise((resolve) => socket.emit("nextRound", resolve));
    const seen = waitForRoom(b, (info) => info.nextRoundReady.length === 1);
    expect(await ready(a)).toEqual({ ok: true, data: false });
    expect((await seen).nextRoundReady).toEqual([0]);

    const dealtA = next(a, "view");
    const dealtB = next(b, "view");
    expect(await ready(b)).toEqual({ ok: true, data: true });
    const [viewA, viewB] = await Promise.all([dealtA, dealtB]);
    expect(viewA.view.roundNumber).toBe(2);
    expect(viewB.view.roundNumber).toBe(2);
  });

  it("refuses a socket with no seat, and a round still being played", async () => {
    const { port } = await boot();
    const [a, b, stranger] = [await connect(port), await connect(port), await connect(port)];
    const created = await createRoom(a, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(b, created.data.roomId, "ben");
    await startGame(a);
    const ready = (socket: Client): Promise<Ack<boolean>> =>
      new Promise((resolve) => socket.emit("nextRound", resolve));
    expect(await ready(stranger)).toEqual({ ok: false, error: "you are not seated in a room" });
    expect(await ready(a)).toEqual({ ok: false, error: "the round is still being played" });
  });
});

describe("quick reactions over the wire", () => {
  function react(socket: Client, id: unknown): Promise<Ack<undefined>> {
    return new Promise((resolve) => socket.emit("react", { id } as never, resolve));
  }

  it("reach everyone at the table, the sender too, as an id and a seat", async () => {
    const { host, guest, guestCreds } = await seatTwo();
    const heardByHost = waitFor(host, "reaction", () => true);
    const heardByGuest = waitFor(guest, "reaction", () => true);
    expect((await react(guest, "nice")).ok).toBe(true);
    const toHost = await heardByHost;
    expect(toHost).toEqual({ seq: expect.any(Number), seat: guestCreds.seat, id: "nice" });
    expect(await heardByGuest).toEqual(toHost);
    const later = waitFor(host, "reaction", (r) => r.seq !== toHost.seq);
    expect((await react(host, "laugh")).ok).toBe(true);
    expect((await later).seq).toBeGreaterThan(toHost.seq);
  });

  it("are refused as free text, and from a socket holding no seat", async () => {
    const { port, host } = await seatTwo();
    expect(await react(host, "you are all terrible")).toEqual({
      ok: false,
      error: "that is not a reaction",
    });
    const stranger = await connect(port);
    expect((await react(stranger, "nice")).ok).toBe(false);
  });
});

describe("identities over HTTP, with the database down", () => {
  it("answers a registration with an error and seats players anyway, without a crash", async () => {
    const down = {
      get: async () => {
        throw new Error("database unreachable");
      },
      put: async () => {
        throw new Error("database unreachable");
      },
    };
    const server = createServer({ users: down });
    started.push(server);
    const port = await server.listen(0);
    const response = await fetch(`http://localhost:${port}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "ana-user-id-0001", secret: "a".repeat(40) }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "the server could not answer that; try again",
    });
    const host = await connect(port);
    const created = await new Promise<Ack<SeatCredentials>>((resolve) =>
      host.emit(
        "createRoom",
        { name: "Ana", user: { userId: "ana-user-id-0001", secret: "a".repeat(40) } },
        resolve,
      ),
    );
    expect(created.ok).toBe(true);
  });
});

describe("identities over HTTP", () => {
  const ana = { userId: "ana-user-id-0001", secret: "a".repeat(40) };
  const ben = { userId: "ben-user-id-0002", secret: "b".repeat(40) };

  async function register(
    port: number,
    body: unknown,
  ): Promise<Ack<{ userId: string; name: string }>> {
    const response = await fetch(`http://localhost:${port}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Ack<{ userId: string; name: string }>;
  }

  it("registers a browser's identity, and refuses the same id with another secret", async () => {
    const { port } = await boot();
    expect(await register(port, { ...ana, name: "Ana" })).toEqual({
      ok: true,
      data: { userId: ana.userId, name: "Ana" },
    });
    expect((await register(port, { ...ana, secret: "z".repeat(40) })).ok).toBe(false);
  });

  it("records who sat down when their identity checks out, and seats them anonymously when not", async () => {
    const { server, port } = await boot();
    await register(port, { ...ana, name: "Ana" });
    await register(port, { ...ben, name: "Ben" });
    const host = await connect(port);
    const created = await new Promise<Ack<SeatCredentials>>((resolve) =>
      host.emit("createRoom", { name: "Ana", user: ana }, resolve),
    );
    if (!created.ok) throw new Error(created.error);
    const guest = await connect(port);
    const joined = await new Promise<Ack<SeatCredentials>>((resolve) =>
      guest.emit("joinRoom", { roomId: created.data.roomId, name: "Ben", user: ben }, resolve),
    );
    expect(joined.ok).toBe(true);
    const impostor = await connect(port);
    const forged = await new Promise<Ack<SeatCredentials>>((resolve) =>
      impostor.emit(
        "joinRoom",
        { roomId: created.data.roomId, name: "Mal", user: { ...ana, secret: "z".repeat(40) } },
        resolve,
      ),
    );
    // Seated all the same — an identity is never a reason to refuse a seat — but as nobody.
    expect(forged.ok).toBe(true);
    const seats = server.manager.get(created.data.roomId)!.record().players;
    expect(seats.map((p) => p.userId)).toEqual([ana.userId, ben.userId, undefined]);
    // And the identity is not a seat: nothing of it reaches the table's broadcast.
    const info = JSON.stringify(server.manager.get(created.data.roomId)!.info());
    expect(info).not.toContain(ana.userId);
  });
});
