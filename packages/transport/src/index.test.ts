/**
 * The connection's own behaviour, against a fake socket and a fake fetch so each
 * step — open, drop, reconnect, move tables — happens exactly when a test says.
 * That the frames it sends are the ones a real server understands is proved by
 * the server's integration suites, which drive this same client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ack, SeatCredentials } from "@hf/shared";
import { connect, NOT_SEATED, type TableSocket } from "./index";

/** A WebSocket the test drives: it opens, delivers and closes when told to. */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly all: FakeSocket[] = [];
  readyState = 0;
  readonly sent: { id: number; event: string; payload?: unknown }[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text) as { id: number; event: string; payload?: unknown });
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  // --- driven by the test ---
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  reply(id: number, result: Ack<unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ ack: id, result }) });
  }

  push(event: string, payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ event, payload }) });
  }

  /** The request most recently sent. */
  last(): { id: number; event: string; payload?: unknown } {
    return this.sent[this.sent.length - 1]!;
  }
}

const seat: SeatCredentials = { roomId: "ABC234", seat: 0, token: "tok" };

function fakeFetch(answer: Ack<SeatCredentials> | Error): typeof fetch & {
  readonly calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    if (answer instanceof Error) throw answer;
    return { json: async () => answer } as Response;
  }) as unknown as typeof fetch;
  return Object.assign(f, { calls });
}

function make(fetchImpl: typeof fetch = fakeFetch({ ok: true, data: seat })): TableSocket {
  return connect("http://game.example", {
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    fetch: fetchImpl,
    retryDelaysMs: [10, 20],
  });
}

/** Let promises and zero-delay timers run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function emit(socket: TableSocket, event: string, ...args: unknown[]): Promise<Ack<unknown>> {
  return new Promise((resolve) =>
    (socket.emit as (...a: unknown[]) => unknown)(event, ...args, resolve),
  );
}

beforeEach(() => {
  FakeSocket.all.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connecting", () => {
  it("says it is connected once, after the caller has had a chance to listen", async () => {
    const socket = make();
    const heard = vi.fn();
    socket.on("connect", heard);
    expect(heard).not.toHaveBeenCalled();
    await settle();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);
  });

  it("says nothing if it was closed before that", async () => {
    const socket = make();
    const heard = vi.fn();
    socket.on("connect", heard);
    socket.close();
    await settle();
    expect(heard).not.toHaveBeenCalled();
  });

  it("refuses a table request while holding no table, without sending anything", async () => {
    const socket = make();
    expect(await emit(socket, "startGame")).toEqual({ ok: false, error: NOT_SEATED });
    expect(FakeSocket.all).toEqual([]);
  });
});

describe("sitting down", () => {
  it("opens a table over HTTP, then holds its socket and presents the seat there", async () => {
    const fetchImpl = fakeFetch({ ok: true, data: seat });
    const socket = make(fetchImpl);
    const created = emit(socket, "createRoom", { name: "ana", options: { mode: "family" } });
    await settle();
    expect(fetchImpl.calls).toEqual([
      { url: "http://game.example/api/rooms", body: { name: "ana", options: { mode: "family" } } },
    ]);
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe("ws://game.example/api/rooms/ABC234/socket");
    // Nothing goes out until the socket is open; then the queued claim does.
    expect(ws.sent).toEqual([]);
    ws.accept();
    expect(ws.last()).toMatchObject({ event: "resumeSeat", payload: seat });
    ws.reply(ws.last().id, { ok: true, data: seat });
    expect(await created).toEqual({ ok: true, data: seat });
  });

  it("joins a table by code at that table's own path", async () => {
    const fetchImpl = fakeFetch({ ok: true, data: { ...seat, seat: 1 } });
    const socket = make(fetchImpl);
    void emit(socket, "joinRoom", { roomId: "ABC234", name: "ben" });
    await settle();
    expect(fetchImpl.calls).toEqual([
      { url: "http://game.example/api/rooms/ABC234/join", body: { name: "ben" } },
    ]);
  });

  it("passes a refusal straight back, and opens no socket", async () => {
    const socket = make(fakeFetch({ ok: false, error: "no room with that code" }));
    expect(await emit(socket, "joinRoom", { roomId: "NOPE22", name: "ben" })).toEqual({
      ok: false,
      error: "no room with that code",
    });
    expect(FakeSocket.all).toEqual([]);
  });

  it("gives no answer when the server cannot be reached, leaving the caller's timeout to", async () => {
    const socket = make(fakeFetch(new Error("offline")));
    const answer = vi.fn();
    void emit(socket, "createRoom", { name: "ana" }).then(answer);
    await settle();
    expect(answer).not.toHaveBeenCalled();
  });

  it("reports a failed claim of the new seat as it came", async () => {
    const socket = make();
    const created = emit(socket, "createRoom", { name: "ana" });
    await settle();
    const ws = FakeSocket.all[0]!;
    ws.accept();
    ws.reply(ws.last().id, { ok: false, error: "no room with that code" });
    expect(await created).toEqual({ ok: false, error: "no room with that code" });
  });
});

describe("at the table", () => {
  async function seated(): Promise<{ socket: TableSocket; ws: FakeSocket }> {
    const socket = make();
    const resumed = emit(socket, "resumeSeat", seat);
    const ws = FakeSocket.all[0]!;
    ws.accept();
    ws.reply(ws.last().id, { ok: true, data: seat });
    await resumed;
    return { socket, ws };
  }

  it("pairs each reply with its request, whatever order they come back in", async () => {
    const { socket, ws } = await seated();
    const first = emit(socket, "submitAction", { type: "draw" });
    const second = emit(socket, "setPaused", { paused: true });
    const [a, b] = ws.sent.slice(-2);
    ws.reply(b!.id, { ok: false, error: "second" });
    ws.reply(a!.id, { ok: true, data: undefined });
    expect(await first).toEqual({ ok: true, data: undefined });
    expect(await second).toEqual({ ok: false, error: "second" });
    expect(a).toEqual({ id: a!.id, event: "submitAction", payload: { type: "draw" } });
    // A request with no payload sends none.
    void emit(socket, "startGame");
    expect(ws.last()).toEqual({ id: ws.last().id, event: "startGame" });
  });

  it("hands what the server pushes to its listeners, and stops when they unsubscribe", async () => {
    const { socket, ws } = await seated();
    const views = vi.fn();
    const once = vi.fn();
    socket.on("view", views);
    socket.once("room", once);
    ws.push("view", { n: 1 });
    ws.push("room", { r: 1 });
    ws.push("room", { r: 2 });
    socket.off("view", views);
    ws.push("view", { n: 2 });
    expect(views.mock.calls).toEqual([[{ n: 1 }]]);
    expect(once.mock.calls).toEqual([[{ r: 1 }]]);
  });

  it("ignores a frame that is not JSON, and a reply nobody is waiting for", async () => {
    const { ws } = await seated();
    ws.onmessage?.({ data: "not json" });
    ws.reply(999, { ok: true, data: undefined });
    expect(ws.closed).toBe(false);
  });

  it("drops the table when a reclaim is refused as gone, but not when merely unseated", async () => {
    const socket = make();
    const refused = emit(socket, "resumeSeat", seat);
    const ws = FakeSocket.all[0]!;
    ws.accept();
    ws.reply(ws.last().id, { ok: false, error: "no room with that code" });
    await refused;
    expect(ws.closed).toBe(true);
    expect(await emit(socket, "startGame")).toEqual({ ok: false, error: NOT_SEATED });

    const again = emit(socket, "resumeSeat", seat);
    const second = FakeSocket.all[1]!;
    second.accept();
    second.reply(second.last().id, { ok: false, error: NOT_SEATED });
    await again;
    expect(second.closed).toBe(false);
  });

  it("stays on the same socket when reclaiming at the table it already holds", async () => {
    const { socket } = await seated();
    void emit(socket, "resumeSeat", seat);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("gets up from the table on leaving, whatever the server said, without a disconnect", async () => {
    const { socket, ws } = await seated();
    const disconnected = vi.fn();
    socket.on("disconnect", disconnected);
    const left = emit(socket, "leaveRoom");
    ws.reply(ws.last().id, { ok: false, error: "whatever" });
    expect(await left).toEqual({ ok: false, error: "whatever" });
    expect(ws.closed).toBe(true);
    expect(disconnected).not.toHaveBeenCalled();
  });

  it("moves to the next game's table on playing again, and claims the seat there", async () => {
    const { socket, ws } = await seated();
    const next: SeatCredentials = { roomId: "NEXT23", seat: 0, token: "t2" };
    const moved = emit(socket, "playAgain");
    ws.reply(ws.last().id, { ok: true, data: next });
    await settle();
    expect(ws.closed).toBe(true);
    const nextWs = FakeSocket.all[1]!;
    expect(nextWs.url).toBe("ws://game.example/api/rooms/NEXT23/socket");
    nextWs.accept();
    expect(nextWs.last()).toMatchObject({ event: "resumeSeat", payload: next });
    nextWs.reply(nextWs.last().id, { ok: true, data: next });
    expect(await moved).toEqual({ ok: true, data: next });
  });

  it("stays at the table when playing again is refused", async () => {
    const { socket, ws } = await seated();
    const moved = emit(socket, "playAgain");
    ws.reply(ws.last().id, { ok: false, error: "the match is not over yet" });
    expect(await moved).toEqual({ ok: false, error: "the match is not over yet" });
    expect(ws.closed).toBe(false);
  });
});

describe("a dropped socket", () => {
  it("says so, reopens with back-off, and says so again once back", async () => {
    vi.useFakeTimers();
    const socket = make();
    const resumed = emit(socket, "resumeSeat", seat);
    const ws = FakeSocket.all[0]!;
    ws.accept();
    ws.reply(ws.last().id, { ok: true, data: seat });
    await resumed;
    const events: string[] = [];
    socket.on("disconnect", () => events.push("disconnect"));
    socket.on("connect", () => events.push("connect"));

    socket.dropConnection();
    expect(events).toEqual(["disconnect"]);
    expect(socket.connected).toBe(false);

    // The first retry fails to connect; the second, after a longer wait, succeeds.
    await vi.advanceTimersByTimeAsync(10);
    const retry = FakeSocket.all[1]!;
    retry.close();
    await vi.advanceTimersByTimeAsync(19);
    expect(FakeSocket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    const back = FakeSocket.all[2]!;
    // A request made while away waits for the socket, then goes.
    void emit(socket, "startGame");
    expect(back.sent).toEqual([]);
    back.accept();
    expect(events).toEqual(["disconnect", "connect"]);
    expect(back.last()).toMatchObject({ event: "startGame" });
    // The back-off stays at its longest step for further drops.
    socket.dropConnection();
    await vi.advanceTimersByTimeAsync(20);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it("stops trying once closed for good", async () => {
    vi.useFakeTimers();
    const socket = make();
    void emit(socket, "resumeSeat", seat);
    FakeSocket.all[0]!.accept();
    socket.dropConnection();
    socket.disconnect();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(await emit(socket, "startGame")).toEqual({ ok: false, error: NOT_SEATED });
  });

  it("waits a second between tries when given no back-off at all", async () => {
    vi.useFakeTimers();
    const socket = connect("http://game.example", {
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      fetch: fakeFetch({ ok: true, data: seat }),
      retryDelaysMs: [],
    });
    void emit(socket, "resumeSeat", seat);
    FakeSocket.all[0]!.accept();
    socket.dropConnection();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("does nothing when there was no socket to drop", () => {
    const socket = make();
    socket.dropConnection();
    expect(FakeSocket.all).toEqual([]);
  });
});

describe("where it connects", () => {
  it("uses the page's own host when given none", async () => {
    vi.stubGlobal("location", { origin: "https://table.example" });
    try {
      const socket = connect("", {
        WebSocket: FakeSocket as unknown as typeof WebSocket,
        fetch: fakeFetch({ ok: true, data: seat }),
      });
      void emit(socket, "resumeSeat", seat);
      expect(FakeSocket.all[0]!.url).toBe("wss://table.example/api/rooms/ABC234/socket");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to a path on the current host where there is no page", async () => {
    const socket = connect("", {
      WebSocket: FakeSocket as unknown as typeof WebSocket,
      fetch: fakeFetch({ ok: true, data: seat }),
    });
    void emit(socket, "resumeSeat", seat);
    expect(FakeSocket.all[0]!.url).toBe("/api/rooms/ABC234/socket");
  });

  it("uses the global WebSocket and fetch when none are given", async () => {
    const socket = connect("http://game.example");
    expect(socket.connected).toBe(true);
    socket.close();
  });
});
