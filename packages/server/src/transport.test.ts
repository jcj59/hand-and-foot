/**
 * The wire itself, spoken directly rather than through the client: what the
 * server does with frames and requests the client would never send, and how it
 * notices a client that has gone silent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket as WsClient } from "ws";
import { PING, PONG, type Ack, type SeatCredentials, type ServerFrame } from "@hf/shared";
import { createServer, type HandAndFootServer } from "./index";

const servers: HandAndFootServer[] = [];
const sockets: WsClient[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const server of servers.splice(0)) await server.close();
});

async function boot(heartbeatMs?: number): Promise<{ server: HandAndFootServer; base: string }> {
  const server = createServer({ heartbeatMs, cors: ["https://ours.example"] });
  servers.push(server);
  const port = await server.listen(0);
  return { server, base: `localhost:${port}` };
}

async function post(base: string, path: string, body: unknown): Promise<Ack<SeatCredentials>> {
  const response = await fetch(`http://${base}${path}`, {
    method: "POST",
    headers: { origin: "https://ours.example" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Ack<SeatCredentials>;
}

/** A raw socket to a table, and every frame it receives. */
async function open(
  base: string,
  roomId: string,
  options: { origin?: string; autoPong?: boolean } = {},
): Promise<{ ws: WsClient; frames: ServerFrame[]; pongs: () => number }> {
  const ws = new WsClient(`ws://${base}/api/rooms/${roomId}/socket`, {
    origin: options.origin ?? "https://ours.example",
    autoPong: options.autoPong ?? true,
  });
  sockets.push(ws);
  const frames: ServerFrame[] = [];
  let pongs = 0;
  ws.on("message", (data) => {
    if (String(data) === PONG) pongs++;
    else frames.push(JSON.parse(String(data)) as ServerFrame);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, frames, pongs: () => pongs };
}

/** Send a request and wait for its reply. */
async function ask(
  socket: { ws: WsClient; frames: ServerFrame[] },
  id: number,
  event: string,
  payload?: unknown,
): Promise<Ack<unknown>> {
  socket.ws.send(JSON.stringify({ id, event, payload }));
  for (;;) {
    const reply = socket.frames.find((f) => "ack" in f && f.ack === id);
    if (reply && "ack" in reply) return reply.result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("the table socket, spoken directly", () => {
  it("answers a request it does not know with a refusal naming it", async () => {
    const { base } = await boot();
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    const socket = await open(base, seat.data.roomId);
    expect(await ask(socket, 1, "dealMeAces")).toEqual({
      ok: false,
      error: "unknown request: dealMeAces",
    });
  });

  it("ignores frames that are not requests, and answers the next one that is", async () => {
    const { base } = await boot();
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    const socket = await open(base, seat.data.roomId);
    socket.ws.send("not json");
    socket.ws.send(JSON.stringify({ event: "startGame" }));
    socket.ws.send(JSON.stringify({ id: "seven", event: "startGame" }));
    expect(await ask(socket, 2, "resumeSeat", seat.data)).toMatchObject({ ok: true });
    expect(socket.frames.filter((f) => "ack" in f)).toHaveLength(1);
  });

  it("refuses a reclaim with no token, or for another table", async () => {
    const { base } = await boot();
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    const socket = await open(base, seat.data.roomId);
    expect(await ask(socket, 1, "resumeSeat", { roomId: seat.data.roomId })).toEqual({
      ok: false,
      error: "that seat token does not belong to this room",
    });
    expect(await ask(socket, 2, "resumeSeat")).toEqual({
      ok: false,
      error: "no room with that code",
    });
  });

  it("answers the client's keep-alive, at a table and at a code with none", async () => {
    const { base } = await boot();
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    for (const socket of [await open(base, seat.data.roomId), await open(base, "NOSUCH")]) {
      socket.ws.send(PING);
      await vi.waitFor(() => expect(socket.pongs()).toBe(1));
      // Nor is it mistaken for a request.
      expect(socket.frames).toEqual([]);
    }
  });

  it("answers anything asked of a code with no table behind it", async () => {
    const { base } = await boot();
    const socket = await open(base, "NOSUCH");
    expect(await ask(socket, 1, "resumeSeat", { roomId: "NOSUCH", token: "t" })).toEqual({
      ok: false,
      error: "no room with that code",
    });
    expect(await ask(socket, 2, "startGame")).toEqual({
      ok: false,
      error: "you are not seated in a room",
    });
    socket.ws.send("not json");
    expect(await ask(socket, 3, "startGame")).toMatchObject({ ok: false });
  });

  it("lets go of the first seat when one connection claims another at the same table", async () => {
    const { server, base } = await boot();
    const ana = await post(base, "/api/rooms", { name: "ana" });
    if (!ana.ok) throw new Error(ana.error);
    const ben = await post(base, `/api/rooms/${ana.data.roomId}/join`, { name: "ben" });
    if (!ben.ok) throw new Error(ben.error);
    const socket = await open(base, ana.data.roomId);
    await ask(socket, 1, "resumeSeat", ana.data);
    await ask(socket, 2, "resumeSeat", ben.data);
    const room = server.manager.get(ana.data.roomId)!;
    expect(room.seats().map((p) => p.connected)).toEqual([false, true]);
  });

  it("refuses every table request from a connection that holds no seat", async () => {
    const { base } = await boot();
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    const socket = await open(base, seat.data.roomId);
    const requests: [string, unknown][] = [
      ["startGame", undefined],
      ["submitAction", { type: "draw" }],
      ["stageMelds", { melds: [] }],
      ["setPaused", { paused: true }],
      ["setHost", { seat: 0 }],
      ["nextRound", undefined],
      ["playAgain", undefined],
      ["leaveRoom", undefined],
    ];
    for (const [i, [event, payload]] of requests.entries()) {
      expect(await ask(socket, i + 1, event, payload)).toEqual({
        ok: false,
        error: "you are not seated in a room",
      });
    }
  });

  it("does not mark a seat empty when a connection superseded on it moves to another", async () => {
    // Ana reconnected on a new socket; the old one, no longer hers, then claims
    // Ben's seat. Ana must not be marked gone: her new socket holds her seat.
    const { server, base } = await boot();
    const ana = await post(base, "/api/rooms", { name: "ana" });
    if (!ana.ok) throw new Error(ana.error);
    const ben = await post(base, `/api/rooms/${ana.data.roomId}/join`, { name: "ben" });
    if (!ben.ok) throw new Error(ben.error);
    const old = await open(base, ana.data.roomId);
    const fresh = await open(base, ana.data.roomId);
    await ask(old, 1, "resumeSeat", ana.data);
    await ask(fresh, 1, "resumeSeat", ana.data);
    await ask(old, 2, "resumeSeat", ben.data);
    const room = server.manager.get(ana.data.roomId)!;
    expect(room.seats().map((p) => p.connected)).toEqual([true, true]);
  });

  it("seats a player whose name was left out under an empty name", async () => {
    const { base } = await boot();
    const seat = await post(base, "/api/rooms", {});
    expect(seat.ok).toBe(true);
    if (!seat.ok) return;
    const joined = await post(base, `/api/rooms/${seat.data.roomId}/join`, {});
    expect(joined).toMatchObject({ ok: true, data: { seat: 1 } });
  });

  it("will not open a socket on any other path, or for an origin it does not allow", async () => {
    const { base } = await boot();
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    await expect(open(base, `${seat.data.roomId}/elsewhere`)).rejects.toThrow();
    await expect(
      open(base, seat.data.roomId, { origin: "https://theirs.example" }),
    ).rejects.toThrow();
  });

  it("answers a malformed table code with a 404, and keeps serving", async () => {
    const { base } = await boot();
    for (const path of ["/api/rooms/%E0/join", "/api/rooms/%zz/join"]) {
      const response = await fetch(`http://${base}${path}`, {
        method: "POST",
        headers: { origin: "https://ours.example" },
        body: "{}",
      });
      expect(response.status).toBe(404);
    }
    await expect(open(base, "%E0")).rejects.toThrow();
    expect(await post(base, "/api/rooms", { name: "ana" })).toMatchObject({ ok: true });
  });

  it("answers nothing but its own routes", async () => {
    const { base } = await boot();
    expect((await fetch(`http://${base}/elsewhere`)).status).toBe(404);
    expect(
      (await fetch(`http://${base}/api/rooms/ABC234/socket`, { method: "POST", body: "{}" }))
        .status,
    ).toBe(404);
    expect((await fetch(`http://${base}/api/healthz`)).status).toBe(200);
  });
});

describe("closing a table", () => {
  it("tells a player still at it why it closed", async () => {
    const { server, base } = await boot();
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    const socket = await open(base, seat.data.roomId);
    await ask(socket, 1, "resumeSeat", seat.data);
    server.manager.remove(seat.data.roomId, "paused");
    await vi.waitFor(() =>
      expect(socket.frames.at(-1)).toEqual({ event: "tableClosed", payload: { reason: "paused" } }),
    );
  });
});

describe("the heartbeat", () => {
  it("drops a client that stops answering, and marks its seat empty", async () => {
    const { server, base } = await boot(30);
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    // A client whose end has gone quiet: it never answers a ping.
    const silent = await open(base, seat.data.roomId, { autoPong: false });
    await ask(silent, 1, "resumeSeat", seat.data);
    expect(server.manager.get(seat.data.roomId)!.seats()[0]!.connected).toBe(true);
    await new Promise<void>((resolve) => silent.ws.once("close", () => resolve()));
    // The server's side of the close lands a moment after the client's.
    await vi.waitFor(() =>
      expect(server.manager.get(seat.data.roomId)!.seats()[0]!.connected).toBe(false),
    );
  });

  it("keeps a client that answers", async () => {
    const { base } = await boot(20);
    const seat = await post(base, "/api/rooms", { name: "ana" });
    if (!seat.ok) throw new Error(seat.error);
    const live = await open(base, seat.data.roomId);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(live.ws.readyState).toBe(WsClient.OPEN);
  });
});
