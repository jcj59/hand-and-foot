import { describe, it, expect, vi } from "vitest";
import type { Ack, SeatCredentials } from "@hf/shared";
import {
  ACK_TIMEOUT_MS,
  ask,
  connect,
  createRoom,
  joinRoom,
  leaveRoom,
  resumeSeat,
  serverUrl,
  setPaused,
  startGame,
  submitAction,
  type HfClientSocket,
} from "./socket";

/**
 * A socket that records what was emitted and lets the test ack it by hand.
 * Only `emit` is exercised here, so the rest of the Socket surface is not built.
 */
function fakeSocket(): {
  socket: HfClientSocket;
  readonly sent: { event: string; args: unknown[] }[];
  ackLast: (result: Ack<unknown>) => void;
} {
  const sent: { event: string; args: unknown[] }[] = [];
  const acks: ((result: Ack<unknown>) => void)[] = [];
  const socket = {
    emit: (event: string, ...args: unknown[]) => {
      const ack = args[args.length - 1] as (result: Ack<unknown>) => void;
      acks.push(ack);
      sent.push({ event, args: args.slice(0, -1) });
      return socket;
    },
  } as unknown as HfClientSocket;
  return {
    socket,
    sent,
    ackLast: (result) => acks[acks.length - 1](result),
  };
}

describe("serverUrl", () => {
  it("uses the configured server URL when one is set", () => {
    expect(serverUrl({ VITE_SERVER_URL: "https://hf.example" })).toBe("https://hf.example");
  });

  it("falls back to the server's own default port", () => {
    // 3000 is @hf/server's DEFAULT_PORT; a mismatch here means nothing connects
    // locally without extra configuration.
    expect(serverUrl({})).toBe("http://localhost:3000");
  });

  it("reads the real build-time environment when given none", () => {
    // The production call shape. Nothing sets VITE_SERVER_URL under test, so this
    // exercises the default path rather than the injected one.
    expect(serverUrl()).toBe("http://localhost:3000");
  });
});

describe("connect", () => {
  it("opens a websocket-only socket at the given URL", () => {
    // Websocket only on purpose: the long-poll fallback would reconnect as a new
    // socket often enough to keep churning seats on the server.
    const socket = connect("http://localhost:1");
    expect(socket.io.opts.transports).toEqual(["websocket"]);
    socket.close();
  });

  it("builds an independent socket per call", () => {
    // The URL is a required argument, so there is no hidden default to drift from
    // serverUrl(); main.tsx passes it explicitly.
    const a = connect("http://localhost:1");
    const b = connect("http://localhost:2");
    expect(a).not.toBe(b);
    a.close();
    b.close();
  });
});

describe("ask", () => {
  it("resolves with the server's ack", async () => {
    const result = await ask<number>((ack) => ack({ ok: true, data: 7 }));
    expect(result).toEqual({ ok: true, data: 7 });
  });

  it("passes a rejection through unchanged", async () => {
    // A refused move is a value, not an exception — the caller reads `error`.
    const result = await ask((ack) => ack({ ok: false, error: "not your turn" }));
    expect(result).toEqual({ ok: false, error: "not your turn" });
  });

  it("resolves to a rejection when the server never acks", async () => {
    // Otherwise the promise hangs and the UI spins forever.
    const timers: (() => void)[] = [];
    const result = ask(() => {}, 50, ((fn: () => void) => {
      timers.push(fn);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    timers[0]();
    await expect(result).resolves.toEqual({
      ok: false,
      error: "the server did not respond — check your connection",
    });
  });

  it("clears the timer once the ack arrives", async () => {
    // A live timer would fire against a settled promise and, in a real browser,
    // keep the tab awake for the full timeout after every single request.
    const clear = vi.fn();
    await ask<number>(
      (ack) => ack({ ok: true, data: 1 }),
      1_000,
      (() => 42 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout,
      clear as unknown as typeof clearTimeout,
    );
    expect(clear).toHaveBeenCalledWith(42);
  });

  it("ignores an ack that arrives after the timeout", async () => {
    // The server answering late must not overwrite the rejection the caller has
    // already acted on.
    const timers: (() => void)[] = [];
    let late: ((result: Ack<number>) => void) | null = null;
    const result = ask<number>(
      (ack) => {
        late = ack;
      },
      50,
      ((fn: () => void) => {
        timers.push(fn);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
    );
    timers[0]();
    late!({ ok: true, data: 99 });
    expect(await result).toEqual({
      ok: false,
      error: "the server did not respond — check your connection",
    });
  });

  it("defaults to the shared ack timeout", () => {
    expect(ACK_TIMEOUT_MS).toBe(10_000);
  });
});

describe("request helpers", () => {
  it("creates a room with the chosen rules", async () => {
    const { socket, sent, ackLast } = fakeSocket();
    const credentials: SeatCredentials = { roomId: "ABC123", seat: 0, token: "t" };
    const pending = createRoom(socket, "ana", { preset: "west-coast", mode: "competitive" });
    expect(sent[0]).toEqual({
      event: "createRoom",
      args: [{ name: "ana", options: { preset: "west-coast", mode: "competitive" } }],
    });
    ackLast({ ok: true, data: credentials });
    expect(await pending).toEqual({ ok: true, data: credentials });
  });

  it("creates a room with no options when none are chosen", async () => {
    // Omitted options mean the East Coast family game; the server defaults them.
    const { socket, sent, ackLast } = fakeSocket();
    const pending = createRoom(socket, "ana");
    expect(sent[0].args).toEqual([{ name: "ana", options: undefined }]);
    ackLast({ ok: true, data: { roomId: "ABC123", seat: 0, token: "t" } });
    await pending;
  });

  it("joins a room by code", async () => {
    const { socket, sent, ackLast } = fakeSocket();
    const pending = joinRoom(socket, "abc123", "ben");
    expect(sent[0]).toEqual({ event: "joinRoom", args: [{ roomId: "abc123", name: "ben" }] });
    ackLast({ ok: true, data: { roomId: "ABC123", seat: 1, token: "t2" } });
    await pending;
  });

  it("sends the whole credentials object when reclaiming a seat", async () => {
    // The server reads the seat from the token, not from the payload's seat
    // field, but it expects the full object — sending a bare token would be
    // rejected.
    const { socket, sent, ackLast } = fakeSocket();
    const credentials: SeatCredentials = { roomId: "ABC123", seat: 1, token: "t2" };
    const pending = resumeSeat(socket, credentials);
    expect(sent[0]).toEqual({ event: "resumeSeat", args: [credentials] });
    ackLast({ ok: true, data: credentials });
    expect(await pending).toEqual({ ok: true, data: credentials });
  });

  it("leaves a room with no payload", async () => {
    const { socket, sent, ackLast } = fakeSocket();
    const pending = leaveRoom(socket);
    expect(sent[0]).toEqual({ event: "leaveRoom", args: [] });
    ackLast({ ok: true, data: undefined });
    expect(await pending).toEqual({ ok: true, data: undefined });
  });

  it("starts the game with no payload", async () => {
    const { socket, sent, ackLast } = fakeSocket();
    const pending = startGame(socket);
    expect(sent[0]).toEqual({ event: "startGame", args: [] });
    ackLast({ ok: true, data: undefined });
    await pending;
  });

  it("submits an action unchanged", async () => {
    const { socket, sent, ackLast } = fakeSocket();
    const pending = submitAction(socket, { type: "discard", cardId: "c1" });
    expect(sent[0]).toEqual({ event: "submitAction", args: [{ type: "discard", cardId: "c1" }] });
    ackLast({ ok: true, data: undefined });
    await pending;
  });

  it("surfaces a refused action as a rejection", async () => {
    const { socket, ackLast } = fakeSocket();
    const pending = submitAction(socket, { type: "draw" });
    ackLast({ ok: false, error: "it is not your turn" });
    expect(await pending).toEqual({ ok: false, error: "it is not your turn" });
  });

  it("pauses and resumes the table", async () => {
    const { socket, sent, ackLast } = fakeSocket();
    const paused = setPaused(socket, true);
    expect(sent[0]).toEqual({ event: "setPaused", args: [{ paused: true }] });
    ackLast({ ok: true, data: undefined });
    await paused;

    const resumed = setPaused(socket, false);
    expect(sent[1].args).toEqual([{ paused: false }]);
    ackLast({ ok: true, data: undefined });
    await resumed;
  });
});
