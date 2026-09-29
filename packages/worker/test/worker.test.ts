/**
 * The Worker and its tables, inside the Workers runtime, driven by the real client
 * transport — the same code the browser runs — so what is tested is what players
 * use: HTTP to open and join, a WebSocket per table, reconnecting, and a table
 * that survives Cloudflare restarting it.
 */
import {
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAction } from "@hf/engine";
import type { Room, TableChannel } from "@hf/server/core";
import {
  EAST_COAST,
  PING,
  PONG,
  type Ack,
  type SeatCredentials,
  type ViewUpdate,
} from "@hf/shared";
import { connect, type TableSocket } from "@hf/transport";
import { ABANDONED_TABLE_MS, TAKEN, type TableObject } from "../src/table";

const BASE = "http://game.example";

/**
 * A WebSocket for the client transport that connects through the Worker itself:
 * the runtime has no network to dial, so the upgrade is asked of `SELF`.
 */
class WorkerSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private closedByUs = false;

  constructor(url: string) {
    void SELF.fetch(url.replace(/^ws/, "http"), { headers: { upgrade: "websocket" } }).then(
      (response) => {
        const ws = response.webSocket;
        if (!ws || this.closedByUs) return this.onclose?.();
        ws.accept();
        this.ws = ws;
        ws.addEventListener("message", (event) => this.onmessage?.({ data: String(event.data) }));
        ws.addEventListener("close", () => {
          this.readyState = 3;
          this.onclose?.();
        });
        this.readyState = WorkerSocket.OPEN;
        this.onopen?.();
      },
    );
  }

  send(text: string): void {
    this.ws?.send(text);
  }

  close(): void {
    this.closedByUs = true;
    this.readyState = 3;
    this.ws?.close();
  }
}

const sockets: TableSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

function client(): TableSocket {
  const socket = connect(BASE, {
    WebSocket: WorkerSocket,
    fetch: ((input: RequestInfo, init?: RequestInit) => SELF.fetch(input, init)) as typeof fetch,
    retryDelaysMs: [5],
  });
  sockets.push(socket);
  return socket;
}

function ask<T>(socket: TableSocket, event: string, ...args: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve) =>
    (socket.emit as (...a: unknown[]) => unknown)(event, ...args, resolve),
  );
}

function nextView(
  socket: TableSocket,
  ok: (u: ViewUpdate) => boolean = () => true,
): Promise<ViewUpdate> {
  return new Promise((resolve) => {
    const onView = (update: ViewUpdate): void => {
      if (!ok(update)) return;
      socket.off("view", onView);
      resolve(update);
    };
    socket.on("view", onView);
  });
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

/** Two players at a dealt table, each holding their own socket. */
async function dealtTable(): Promise<{
  ana: TableSocket;
  ben: TableSocket;
  anaSeat: SeatCredentials;
  benSeat: SeatCredentials;
  anaView: ViewUpdate;
  benView: ViewUpdate;
}> {
  const ana = client();
  const ben = client();
  const opened = await ask<SeatCredentials>(ana, "createRoom", {
    name: "ana",
    options: { mode: "family" },
  });
  if (!opened.ok) throw new Error(opened.error);
  const joined = await ask<SeatCredentials>(ben, "joinRoom", {
    roomId: opened.data.roomId.toLowerCase(),
    name: "ben",
  });
  if (!joined.ok) throw new Error(joined.error);
  const views = [nextView(ana), nextView(ben)] as const;
  expect(await ask(ana, "startGame")).toEqual({ ok: true, data: undefined });
  const [anaView, benView] = await Promise.all(views);
  return { ana, ben, anaSeat: opened.data, benSeat: joined.data, anaView, benView };
}

function tableOf(code: string): DurableObjectStub<TableObject> {
  return env.TABLES.getByName(code);
}

/** Reach inside a table object, for what a test cannot do through the wire. */
function insideTable<T>(code: string, fn: (room: Room, channel: TableChannel) => T): Promise<T> {
  return runInDurableObject(tableOf(code), (instance: TableObject) => {
    const channel = (instance as unknown as { channel: TableChannel }).channel;
    return fn(channel.room, channel);
  });
}

/** Cancel the turn clock's pending timer, which holds the object awake. */
function stopClock(room: Room): void {
  const internal = room as unknown as { cancelTimer: (() => void) | null };
  internal.cancelTimer?.();
  internal.cancelTimer = null;
}

describe("the Worker", () => {
  it("answers a health check", async () => {
    const response = await SELF.fetch(`${BASE}/api/healthz`);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("answers nothing else under /api", async () => {
    expect((await SELF.fetch(`${BASE}/api/nope`)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/api/rooms/ABC234/join`)).status).toBe(405);
  });

  it("refuses a request body that is not a JSON object", async () => {
    for (const body of ["not json", "[1]", JSON.stringify({ name: "x".repeat(20_000) })]) {
      const opened = await SELF.fetch(`${BASE}/api/rooms`, { method: "POST", body });
      expect(opened.status).toBe(400);
      const joined = await SELF.fetch(`${BASE}/api/rooms/ABC234/join`, { method: "POST", body });
      expect(joined.status).toBe(400);
    }
  });

  it("serves the client's page for anything that is not the API", async () => {
    const page = await SELF.fetch(`${BASE}/room/ABC234`, {
      headers: { "sec-fetch-mode": "navigate" },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
  });
});

/** A socket to a table spoken to directly, collecting every frame it receives. */
async function rawSocket(code: string): Promise<{ ws: WebSocket; frames: unknown[] }> {
  const response = await SELF.fetch(`${BASE}/api/rooms/${code}/socket`, {
    headers: { upgrade: "websocket" },
  });
  const ws = response.webSocket!;
  ws.accept();
  const frames: unknown[] = [];
  ws.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data))));
  return { ws, frames };
}

describe("a table socket, spoken to directly", () => {
  it("is only a socket: a plain request at its path is refused", async () => {
    expect((await SELF.fetch(`${BASE}/api/rooms/ABC234/socket`)).status).toBe(426);
  });

  it("ignores what is not a request, and reads one sent as bytes", async () => {
    const lone = client();
    const opened = await ask<SeatCredentials>(lone, "createRoom", { name: "ana" });
    if (!opened.ok) throw new Error(opened.error);
    const { ws, frames } = await rawSocket(opened.data.roomId);
    ws.send("not json");
    ws.send(JSON.stringify({ event: "startGame" }));
    ws.send(new TextEncoder().encode(JSON.stringify({ id: 9, event: "startGame" })));
    await until(() => frames.length > 0);
    expect(frames).toEqual([
      { ack: 9, result: { ok: false, error: "you are not seated in a room" } },
    ]);
    ws.close();
  });

  it("stops speaking for a closed table's sockets once a new one opens under its code", async () => {
    const lone = client();
    const opened = await ask<SeatCredentials>(lone, "createRoom", { name: "ana" });
    if (!opened.ok) throw new Error(opened.error);
    const code = opened.data.roomId;
    const { ws, frames } = await rawSocket(code);
    // Reaped, then opened again by someone else.
    lone.close();
    await until(() => insideTable(code, (room) => room.abandonedSince !== null));
    await insideTable(code, (room) => {
      for (const player of room.seats())
        player.disconnectedAt = Date.now() - ABANDONED_TABLE_MS - 1;
    });
    await runInDurableObject(tableOf(code), (instance: TableObject) => instance.alarm());
    expect(await tableOf(code).open(code, EAST_COAST, "eve")).toMatchObject({ ok: true });
    // The old socket is answered as at a code with no table, not as the new one.
    ws.send(JSON.stringify({ id: 1, event: "resumeSeat", payload: opened.data }));
    await until(() => frames.length > 0);
    expect(frames).toEqual([{ ack: 1, result: { ok: false, error: "no room with that code" } }]);
    ws.close();
  });
});

describe("a table", () => {
  it("opens, seats a second player, and deals each their own hand only", async () => {
    const { anaView, benView, anaSeat, benSeat } = await dealtTable();
    expect(anaSeat.seat).toBe(0);
    expect(benSeat.seat).toBe(1);
    expect(benSeat.roomId).toBe(anaSeat.roomId);
    expect(anaView.view.seat).toBe(0);
    expect(benView.view.seat).toBe(1);
    // The anti-cheat boundary, over this transport too: an opponent is counts only.
    expect(anaView.view.opponents[0]).not.toHaveProperty("hand");
    const anaIds = new Set(anaView.view.hand.map((c) => c.id));
    expect(benView.view.hand.some((c) => anaIds.has(c.id))).toBe(false);
  });

  it("plays moves through the shared rules, and refuses one out of turn", async () => {
    const { ana, ben, anaView } = await dealtTable();
    const [onTurn, waiting] = anaView.hints.seatToAct === 0 ? [ana, ben] : [ben, ana];
    expect(await ask(waiting, "submitAction", { type: "draw" })).toEqual({
      ok: false,
      error: "it is not your turn",
    });
    expect(await ask(onTurn, "submitAction", { type: "draw" })).toEqual({
      ok: true,
      data: undefined,
    });
  });

  it("will not open a second table under a code already in use", async () => {
    const { anaSeat } = await dealtTable();
    expect(await tableOf(anaSeat.roomId).open(anaSeat.roomId, {} as never, "eve")).toBe(TAKEN);
  });

  it("tells a client at a code with no table that the room is gone", async () => {
    const lost = client();
    expect(await ask(lost, "resumeSeat", { roomId: "ZZZZZZ", seat: 0, token: "t" })).toEqual({
      ok: false,
      error: "no room with that code",
    });
    expect(await ask(client(), "joinRoom", { roomId: "ZZZZZZ", name: "eve" })).toEqual({
      ok: false,
      error: "no room with that code",
    });
  });

  it("comes back exactly as it was when Cloudflare restarts it mid-game", async () => {
    const { ana, ben, anaSeat, benSeat, anaView } = await dealtTable();
    const [onTurn] = anaView.hints.seatToAct === 0 ? [ana] : [ben];
    await ask(onTurn, "submitAction", { type: "draw" });
    const before = await insideTable(anaSeat.roomId, (room) => room.gameState);

    // Evicted, sockets and all: what a deploy or a runtime restart does. A real
    // restart does not wait for the turn clock's timer; the test runtime's
    // eviction does, so the timer is cleared first.
    await insideTable(anaSeat.roomId, stopClock);
    let dropped = 0;
    ana.on("disconnect", () => dropped++);
    await evictDurableObject(tableOf(anaSeat.roomId), { webSockets: "close" });
    // Each client reconnects on its own and reclaims its seat with its token.
    await until(() => dropped > 0 && ana.connected && ben.connected);
    const anaBack = await ask<SeatCredentials>(ana, "resumeSeat", anaSeat);
    const benBack = await ask<SeatCredentials>(ben, "resumeSeat", benSeat);
    expect(anaBack.ok && benBack.ok).toBe(true);

    expect(await insideTable(anaSeat.roomId, (room) => room.gameState)).toEqual(before);
    // And play goes on from there.
    const state = before!;
    const mover = state.currentSeat === 0 ? ana : ben;
    expect(await ask(mover, "submitAction", defaultAction(state))).toEqual({
      ok: true,
      data: undefined,
    });
  });

  it("sleeps while paused with its sockets open, and wakes with every seat still held", async () => {
    const { ana, ben, anaSeat, anaView, benView } = await dealtTable();
    const code = anaSeat.roomId;
    const [onTurn, waiting, waitingView] =
      anaView.hints.seatToAct === 0 ? [ana, ben, benView] : [ben, ana, anaView];
    await ask(onTurn, "submitAction", { type: "draw" });
    const before = await insideTable(code, (room) => room.gameState);
    let dropped = 0;
    ana.on("disconnect", () => dropped++);
    ben.on("disconnect", () => dropped++);

    // A paused table has no clock running, so nothing keeps the object awake.
    expect(await ask(waiting, "setPaused", { paused: true })).toEqual({
      ok: true,
      data: undefined,
    });
    // Hibernated: the object's memory is gone, its sockets are not.
    await evictDurableObject(tableOf(code));

    // The keep-alive is answered without anything else stirring.
    // (Answered by the runtime itself, so a raw socket is used to see it.)
    const raw = await SELF.fetch(`${BASE}/api/rooms/${code}/socket`, {
      headers: { upgrade: "websocket" },
    });
    const ws = raw.webSocket!;
    ws.accept();
    const pong = new Promise((resolve) => ws.addEventListener("message", (e) => resolve(e.data)));
    ws.send(PING);
    expect(await pong).toBe(PONG);
    ws.close();

    // The first message wakes it. Nobody reconnected or presented a token again,
    // and yet it knows who is who: the table is still paused, by the same seat;
    // the waiting player is still refused a move, the player on turn still plays,
    // and each still sees only their own hand.
    expect(await ask(onTurn, "setPaused", { paused: true })).toEqual({
      ok: false,
      error: "the table is already paused",
    });
    expect(await insideTable(code, (room) => room.info().pausedBy)).toBe(waitingView.view.seat);
    expect(await ask(waiting, "setPaused", { paused: false })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await ask(waiting, "submitAction", { type: "draw" })).toEqual({
      ok: false,
      error: "it is not your turn",
    });
    const state = before!;
    const seen = nextView(waiting);
    expect(await ask(onTurn, "submitAction", defaultAction(state))).toEqual({
      ok: true,
      data: undefined,
    });
    const after = await seen;
    expect(after.view.seat).toBe(waitingView.view.seat);
    expect(after.view.hand).toEqual(waitingView.view.hand);
    expect(dropped).toBe(0);
    expect(await insideTable(code, (room) => room.seats().map((p) => p.connected))).toEqual([
      true,
      true,
    ]);
  });

  it("remembers who is ready for the next round through a sleep", async () => {
    const { ana, anaSeat } = await dealtTable();
    const code = anaSeat.roomId;
    await insideTable(code, (room) => {
      const internal = room as unknown as { state: object };
      internal.state = { ...room.gameState!, roundEnded: true };
      // As the round's real end does: no clock between rounds.
      stopClock(room);
    });
    expect(await ask(ana, "nextRound")).toEqual({ ok: true, data: false });
    await evictDurableObject(tableOf(code));
    expect(await insideTable(code, (room) => room.info().nextRoundReady)).toEqual([0]);
  });

  it("moves players to the next game's table, the same one for each, once the match is over", async () => {
    const { ana, ben, anaSeat } = await dealtTable();
    await insideTable(anaSeat.roomId, (room) => {
      const internal = room as unknown as { state: object };
      internal.state = { ...room.gameState!, roundEnded: true, roundNumber: room.config.rounds };
    });
    const anaNext = await ask<SeatCredentials>(ana, "playAgain");
    if (!anaNext.ok) throw new Error(anaNext.error);
    expect(anaNext.data.roomId).not.toBe(anaSeat.roomId);
    const benNext = await ask<SeatCredentials>(ben, "playAgain");
    expect(benNext).toMatchObject({ ok: true, data: { roomId: anaNext.data.roomId, seat: 1 } });

    // The first to go hosts, and deals.
    const dealt = nextView(ben);
    expect(await ask(ana, "startGame")).toEqual({ ok: true, data: undefined });
    expect((await dealt).room.roomId).toBe(anaNext.data.roomId);

    // Someone left behind is told the next game started without them.
    await insideTable(anaSeat.roomId, (room) => {
      room.nextRoomId = anaNext.data.roomId;
    });
  });

  it("sends two players who ask for the next game at once to the same table", async () => {
    const { ana, ben, anaSeat } = await dealtTable();
    await insideTable(anaSeat.roomId, (room) => {
      const internal = room as unknown as { state: object };
      internal.state = { ...room.gameState!, roundEnded: true, roundNumber: room.config.rounds };
    });
    const [anaNext, benNext] = await Promise.all([
      ask<SeatCredentials>(ana, "playAgain"),
      ask<SeatCredentials>(ben, "playAgain"),
    ]);
    if (!anaNext.ok) throw new Error(anaNext.error);
    if (!benNext.ok) throw new Error(benNext.error);
    expect(benNext.data.roomId).toBe(anaNext.data.roomId);
    expect([anaNext.data.seat, benNext.data.seat].sort()).toEqual([0, 1]);
    expect(await insideTable(anaSeat.roomId, (room) => room.nextRoomId)).toBe(anaNext.data.roomId);
  });

  it("seats a player who clicks play again twice only once at the next table", async () => {
    const { anaSeat } = await dealtTable();
    await insideTable(anaSeat.roomId, (room) => {
      const internal = room as unknown as { state: object };
      internal.state = { ...room.gameState!, roundEnded: true, roundNumber: room.config.rounds };
    });
    // A raw socket, so both answers are seen: the client transport moves tables on
    // the first and stops listening here.
    const response = await SELF.fetch(`${BASE}/api/rooms/${anaSeat.roomId}/socket`, {
      headers: { upgrade: "websocket" },
    });
    const ws = response.webSocket!;
    ws.accept();
    const acks = new Map<number, Ack<SeatCredentials>>();
    ws.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as { ack?: number; result?: unknown };
      if (frame.ack !== undefined) acks.set(frame.ack, frame.result as Ack<SeatCredentials>);
    });
    ws.send(JSON.stringify({ id: 1, event: "resumeSeat", payload: anaSeat }));
    await until(() => acks.has(1));
    ws.send(JSON.stringify({ id: 2, event: "playAgain" }));
    ws.send(JSON.stringify({ id: 3, event: "playAgain" }));
    await until(() => acks.has(2) && acks.has(3));
    ws.close();
    const first = acks.get(2)!;
    if (!first.ok) throw new Error(first.error);
    expect(acks.get(3)).toEqual(first);
    expect(await insideTable(first.data.roomId, (room) => room.seats().map((p) => p.name))).toEqual(
      ["ana"],
    );
  });

  it("refuses a late comer to a next game already dealt, and opens a fresh one if it was reaped", async () => {
    const next = client();
    const opened = await ask<SeatCredentials>(next, "createRoom", { name: "ana" });
    if (!opened.ok) throw new Error(opened.error);
    await ask(client(), "joinRoom", { roomId: opened.data.roomId, name: "ben" });
    await ask(next, "startGame");
    expect(await tableOf(opened.data.roomId).sitNext("cy")).toEqual({
      ok: false,
      error: "the next game has already started without you",
    });
  });

  it("closes a table everyone has left, freeing its code", async () => {
    const lone = client();
    const opened = await ask<SeatCredentials>(lone, "createRoom", { name: "ana" });
    if (!opened.ok) throw new Error(opened.error);
    lone.close();
    const code = opened.data.roomId;
    await until(() => insideTable(code, (room) => room.abandonedSince !== null));

    // Not yet: the alarm only reminds the table to look.
    expect(await runDurableObjectAlarm(tableOf(code))).toBe(true);
    expect(await insideTable(code, (room) => room.id)).toBe(code);

    // Long enough ago, it goes.
    await insideTable(code, (room) => {
      for (const player of room.seats())
        player.disconnectedAt = Date.now() - ABANDONED_TABLE_MS - 1;
    });
    await runInDurableObject(tableOf(code), (instance: TableObject) => instance.alarm());
    expect(await ask(client(), "resumeSeat", opened.data)).toEqual({
      ok: false,
      error: "no room with that code",
    });
    // And a new table can be opened under it.
    expect(await tableOf(code).open(code, EAST_COAST, "eve")).toMatchObject({ ok: true });
  });
});
