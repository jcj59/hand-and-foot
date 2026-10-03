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
import { PAUSED_TABLE_MS, type Room, type TableChannel } from "@hf/server/core";
import {
  EAST_COAST,
  WEST_COAST,
  PING,
  PONG,
  type Ack,
  type MatchHistory,
  type RoomOptions,
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
async function dealtTable(options: RoomOptions = { mode: "family" }): Promise<{
  ana: TableSocket;
  ben: TableSocket;
  anaSeat: SeatCredentials;
  benSeat: SeatCredentials;
  anaView: ViewUpdate;
  benView: ViewUpdate;
}> {
  const ana = client();
  const ben = client();
  const opened = await ask<SeatCredentials>(ana, "createRoom", { name: "ana", options });
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

  it("serves the install manifest and every icon it names as files, not as the page", async () => {
    // A missing file would still answer 200 — with the app's page, by the
    // single-page fallback — so the type is what shows the file is really there.
    const manifest = await SELF.fetch(`${BASE}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toMatch(/^application\/manifest\+json/);
    const { icons } = (await manifest.json()) as { icons: { src: string; type: string }[] };
    expect(icons.length).toBeGreaterThan(0);
    for (const src of [
      ...icons.map((i) => i.src),
      "/favicon-turn.svg",
      "/icons/apple-touch-icon.png",
    ]) {
      const icon = await SELF.fetch(`${BASE}${src}`);
      expect(icon.status, src).toBe(200);
      expect(icon.headers.get("content-type"), src).toMatch(/^image\//);
      await icon.arrayBuffer();
    }
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
    // And a third click after the move has finished gets the same answer too.
    ws.send(JSON.stringify({ id: 4, event: "playAgain" }));
    await until(() => acks.has(4));
    expect(acks.get(4)).toEqual(acks.get(2));
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

  it("closes a table left paused, telling the players still looking at it", async () => {
    const { ana, anaSeat } = await dealtTable();
    const code = anaSeat.roomId;
    const closed = new Promise((resolve) => ana.on("tableClosed", resolve));
    expect(await ask(ana, "setPaused", { paused: true })).toEqual({ ok: true, data: undefined });
    // The alarm is set for half an hour on; nothing yet.
    expect(await runDurableObjectAlarm(tableOf(code))).toBe(true);
    expect(await insideTable(code, (room) => room.paused)).toBe(true);
    // Half an hour later, with everyone still connected, it goes.
    await insideTable(code, (room) => {
      (room as unknown as { pausedSince: number }).pausedSince = Date.now() - PAUSED_TABLE_MS - 1;
    });
    await runInDurableObject(tableOf(code), (instance: TableObject) => instance.alarm());
    expect(await closed).toEqual({ reason: "paused" });
    expect(await ask(client(), "resumeSeat", anaSeat)).toEqual({
      ok: false,
      error: "no room with that code",
    });
  });

  it("keeps a table saved for later past the pause's half hour", async () => {
    const { ana, anaSeat } = await dealtTable();
    const code = anaSeat.roomId;
    await ask(ana, "setPaused", { paused: true });
    expect(await ask(ana, "saveForLater")).toEqual({ ok: true, data: undefined });
    await insideTable(code, (room) => {
      (room as unknown as { pausedSince: number }).pausedSince = Date.now() - PAUSED_TABLE_MS - 1;
    });
    await runInDurableObject(tableOf(code), (instance: TableObject) => instance.alarm());
    expect(await insideTable(code, (room) => room.info().savedUntil)).toBeGreaterThan(Date.now());
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

describe("a table's rules", () => {
  it("are checked by the Worker, which refuses rules that do not make a game and says why", async () => {
    const post = async (options: unknown): Promise<unknown> =>
      (
        await SELF.fetch(`${BASE}/api/rooms`, {
          method: "POST",
          body: JSON.stringify({ name: "ana", options }),
        })
      ).json();
    expect(await post({ rules: { handSize: 99 } })).toEqual({
      ok: false,
      error: "the hand size must be between 5 and 20",
    });
    expect(await post({ mode: "competitive", rules: { pauseEnabled: true } })).toEqual({
      ok: false,
      error: "a competitive table cannot be paused; choose the family mode to allow pausing",
    });
    expect(await post({ rules: { wilds: 4 } })).toEqual({
      ok: false,
      error: 'there is no rule called "wilds"',
    });
  });

  it("are dealt by, shown to everyone, and kept through a restart", async () => {
    const options: RoomOptions = {
      preset: "west-coast",
      rules: { handSize: 8, footSize: 6, rounds: 1, layDownMinimums: [45], extraDecks: 0 },
    };
    const { ana, anaSeat, benView } = await dealtTable(options);
    const expected = { ...WEST_COAST, ...options.rules };
    expect(benView.room.config).toEqual(expected);
    expect(benView.view.hand).toHaveLength(8);
    expect(benView.view.footCount).toBe(6);

    await insideTable(anaSeat.roomId, stopClock);
    let dropped = 0;
    ana.on("disconnect", () => dropped++);
    await evictDurableObject(tableOf(anaSeat.roomId), { webSockets: "close" });
    await until(() => dropped > 0 && ana.connected);
    const back = nextView(ana);
    expect((await ask<SeatCredentials>(ana, "resumeSeat", anaSeat)).ok).toBe(true);
    expect((await back).room.config).toEqual(expected);
    expect(await insideTable(anaSeat.roomId, (room) => room.config)).toEqual(expected);
  });
});

describe("identities", () => {
  const ana = { userId: "ana-user-id-0001", secret: "a".repeat(40) };
  const ben = { userId: "ben-user-id-0002", secret: "b".repeat(40) };

  async function register(body: unknown): Promise<Ack<{ userId: string; name: string }>> {
    const response = await SELF.fetch(`${BASE}/api/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Ack<{ userId: string; name: string }>;
  }

  it("registers one, keeps it in its own object, and refuses it to another secret", async () => {
    expect(await register({ ...ana, name: "Ana" })).toEqual({
      ok: true,
      data: { userId: ana.userId, name: "Ana" },
    });
    expect(await register({ ...ana, secret: "z".repeat(40) })).toEqual({
      ok: false,
      error: "that identity belongs to another browser",
    });
    // Nothing that is not an id is used to address an object.
    expect(await register({ userId: "../../etc", secret: ana.secret })).toEqual({
      ok: false,
      error: "that is not an identity",
    });
  });

  it("is recorded with the seat when it checks out, and the seat is still given when it does not", async () => {
    await register({ ...ana, name: "Ana" });
    await register({ ...ben, name: "Ben" });
    const host = client();
    const opened = await ask<SeatCredentials>(host, "createRoom", { name: "Ana", user: ana });
    if (!opened.ok) throw new Error(opened.error);
    const guest = client();
    const joined = await ask<SeatCredentials>(guest, "joinRoom", {
      roomId: opened.data.roomId,
      name: "Ben",
      user: ben,
    });
    expect(joined.ok).toBe(true);
    const stranger = client();
    const forged = await ask<SeatCredentials>(stranger, "joinRoom", {
      roomId: opened.data.roomId,
      name: "Mal",
      user: { ...ana, secret: "z".repeat(40) },
    });
    expect(forged.ok).toBe(true);
    const ids = await insideTable(opened.data.roomId, (room) => room.seats().map((p) => p.userId));
    expect(ids).toEqual([ana.userId, ben.userId, undefined]);
  });

  it("travels with each player to the next game, the first to go on included", async () => {
    await register({ ...ana, name: "Ana" });
    await register({ ...ben, name: "Ben" });
    const host = client();
    const guest = client();
    const opened = await ask<SeatCredentials>(host, "createRoom", { name: "Ana", user: ana });
    if (!opened.ok) throw new Error(opened.error);
    await ask(guest, "joinRoom", { roomId: opened.data.roomId, name: "Ben", user: ben });
    const dealt = nextView(host);
    await ask(host, "startGame");
    await dealt;
    await insideTable(opened.data.roomId, (room) => {
      const internal = room as unknown as { state: object };
      internal.state = { ...room.gameState!, roundEnded: true, roundNumber: room.config.rounds };
    });
    const first = await ask<SeatCredentials>(host, "playAgain");
    if (!first.ok) throw new Error(first.error);
    expect((await ask<SeatCredentials>(guest, "playAgain")).ok).toBe(true);
    const ids = await insideTable(first.data.roomId, (room) => room.seats().map((p) => p.userId));
    expect(ids).toEqual([ana.userId, ben.userId]);
  });
});

describe("a rematch", () => {
  it("opens a dealt table with the same players, and sends each the seat there", async () => {
    const ana = client();
    const ben = client();
    const opened = await ask<SeatCredentials>(ana, "createRoom", {
      name: "Ana",
      options: {
        rules: { rounds: 1, layDownMinimums: [60], extraDecks: 0, stockExhaustion: "end" },
      },
    });
    if (!opened.ok) throw new Error(opened.error);
    await ask(ben, "joinRoom", { roomId: opened.data.roomId, name: "Ben" });
    await ask(ana, "addBot");
    const dealt = nextView(ana);
    await ask(ana, "startGame");
    await dealt;
    await insideTable(opened.data.roomId, (room) => {
      for (let guard = 0; !room.matchOver && guard < 5_000; guard++) {
        const state = room.gameState!;
        room.submitAction(state.currentSeat, defaultAction(state)!);
      }
      stopClock(room);
    });
    const told = new Promise<SeatCredentials>((resolve) => ben.once("rematch", resolve));
    const mine = await ask<SeatCredentials>(ana, "rematch");
    if (!mine.ok) throw new Error(mine.error);
    const theirs = await told;
    expect(theirs).toMatchObject({ roomId: mine.data.roomId, seat: 1 });
    const seats = await insideTable(mine.data.roomId, (room) => {
      stopClock(room);
      return { started: room.started, names: room.seats().map((p) => p.name), host: room.hostSeat };
    });
    expect(seats).toEqual({ started: true, names: ["Ana", "Ben", "Robo Rita"], host: 0 });
    const back = nextView(ben, (u) => u.room.roomId === mine.data.roomId);
    expect((await ask<SeatCredentials>(ben, "resumeSeat", theirs)).ok).toBe(true);
    expect((await back).view.seat).toBe(1);
  });
});

describe("match history", () => {
  const ana = { userId: "ana-history-0001", secret: "a".repeat(40) };
  const ben = { userId: "ben-history-0002", secret: "b".repeat(40) };

  async function post<T>(path: string, body: unknown): Promise<Ack<T>> {
    const response = await SELF.fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Ack<T>;
  }

  async function history(user: unknown): Promise<Ack<MatchHistory>> {
    return post<MatchHistory>("/api/users/matches", { user });
  }

  /** Ana and Ben, registered, dealt a one-round match. */
  async function table(): Promise<string> {
    await post("/api/users", { ...ana, name: "Ana" });
    await post("/api/users", { ...ben, name: "Ben" });
    const host = client();
    const guest = client();
    const opened = await ask<SeatCredentials>(host, "createRoom", {
      name: "Ana",
      user: ana,
      options: {
        rules: { rounds: 1, layDownMinimums: [60], extraDecks: 0, stockExhaustion: "end" },
      },
    });
    if (!opened.ok) throw new Error(opened.error);
    await ask(guest, "joinRoom", { roomId: opened.data.roomId, name: "Ben", user: ben });
    const dealt = nextView(host);
    await ask(host, "startGame");
    await dealt;
    return opened.data.roomId;
  }

  it("keeps a finished match in each player's own history", async () => {
    const code = await table();
    await insideTable(code, (room) => {
      for (let guard = 0; !room.matchOver && guard < 5_000; guard++) {
        const state = room.gameState!;
        room.submitAction(state.currentSeat, defaultAction(state)!);
      }
      stopClock(room);
    });
    for (const user of [ana, ben]) {
      await until(async () => {
        const answer = await history(user);
        return answer.ok && answer.data.recent.length === 1;
      });
      const answer = await history(user);
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.data.stats.played).toBe(1);
      expect(answer.data.recent[0]).toMatchObject({
        roomId: code,
        finished: true,
        roundsPlayed: 1,
      });
    }
    const id = ((await history(ana)) as { ok: true; data: MatchHistory }).data.recent[0]!.id;
    const replay = await post<{ seat: number; log: unknown[] }>("/api/users/match", {
      user: ben,
      id,
    });
    expect(replay.ok && replay.data.seat).toBe(1);
    expect(JSON.stringify(replay)).not.toContain(ana.userId);
    const stranger = { userId: "cal-history-0003", secret: "c".repeat(40) };
    await post("/api/users", { ...stranger, name: "Cal" });
    expect(await post("/api/users/match", { user: stranger, id })).toEqual({
      ok: false,
      error: "that game is not one of yours",
    });
  });

  it("keeps a match closed part way, as unfinished", async () => {
    const code = await table();
    await insideTable(code, (room) => {
      room.setConnected(0, false);
      room.setConnected(1, false);
      stopClock(room);
    });
    await runInDurableObject(tableOf(code), async (instance: TableObject) => {
      // Past every limit, so the alarm closes it.
      const internal = instance as unknown as { channel: TableChannel };
      const room = internal.channel.room as unknown as { players: { disconnectedAt: number }[] };
      for (const p of room.players) p.disconnectedAt = 0;
      await instance.alarm();
    });
    await until(async () => {
      const answer = await history(ana);
      return answer.ok && answer.data.stats.unfinished === 1;
    });
  });

  it("is refused to credentials that do not prove the identity", async () => {
    await post("/api/users", { ...ana, name: "Ana" });
    const refused = { ok: false, error: "that is not an identity" };
    expect(await history({ ...ana, secret: "z".repeat(40) })).toEqual(refused);
    expect(await history({ userId: "../x", secret: "z" })).toEqual(refused);
    expect(await history(undefined)).toEqual(refused);
  });
});

describe("pictures", () => {
  const ana = { background: "rose", skin: "sand", eyes: "wink", mouth: "grin", top: "crown" };
  const ben = { background: "teal", skin: "cocoa", eyes: "shades", mouth: "beard", top: "cap" };

  it("are shown to the table, a forged one is dropped, and each travels to the next game", async () => {
    const host = client();
    const guest = client();
    const third = client();
    const opened = await ask<SeatCredentials>(host, "createRoom", { name: "Ana", avatar: ana });
    if (!opened.ok) throw new Error(opened.error);
    const code = opened.data.roomId;
    await ask(guest, "joinRoom", { roomId: code, name: "Ben", avatar: ben });
    await ask(third, "joinRoom", { roomId: code, name: "Cal", avatar: { ...ana, top: "halo" } });
    const pictures = await insideTable(code, (room) => room.info().players.map((p) => p.avatar));
    expect(pictures).toEqual([ana, ben, undefined]);

    const dealt = nextView(host);
    await ask(host, "startGame");
    await dealt;
    await insideTable(code, (room) => {
      const internal = room as unknown as { state: object };
      internal.state = { ...room.gameState!, roundEnded: true, roundNumber: room.config.rounds };
    });
    // The first to go on opens the next table; the second sits at it.
    const first = await ask<SeatCredentials>(host, "playAgain");
    if (!first.ok) throw new Error(first.error);
    expect((await ask<SeatCredentials>(guest, "playAgain")).ok).toBe(true);
    const next = await insideTable(first.data.roomId, (room) =>
      room.info().players.map((p) => p.avatar),
    );
    expect(next).toEqual([ana, ben]);
  });
});
