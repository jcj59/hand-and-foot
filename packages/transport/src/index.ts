/**
 * The client's connection to the game, over plain WebSockets.
 *
 * It keeps the shape the client was written against — `emit` with an ack callback,
 * `on`/`off` for what the server pushes, `connect` and `disconnect` events — so
 * nothing above it changes. What it does underneath is new, because the server
 * can now be a Cloudflare Durable Object per table rather than one process holding
 * every table:
 *
 * - Opening a table and sitting down at one are HTTP requests. They happen before
 *   there is a table to hold a socket to.
 * - Once seated, the client holds one WebSocket to that table, and every other
 *   request and broadcast goes over it. Moving to another table — playing again —
 *   moves the socket with it.
 * - A socket that drops is reopened with back-off. The server sees a new
 *   connection that holds no seat until it presents its token again, which the
 *   client's own reclaim-on-reconnect already does on the `connect` event.
 */
import {
  isAckFrame,
  joinPath,
  PING,
  PONG,
  ROOMS_PATH,
  socketPath,
  type Ack,
  type ClientFrame,
  type ClientToServerEvents,
  type SeatCredentials,
  type ServerFrame,
  type ServerToClientEvents,
} from "@hf/shared";

/** What a listener can be attached to: the server's pushes, and the connection's own. */
export type SocketEvents = ServerToClientEvents & {
  connect: () => void;
  disconnect: () => void;
};

type Listener = (payload?: unknown) => void;

/** Refused without trying: there is no table to send it to. */
export const NOT_SEATED = "you are not seated in a room";

/** Back-off between attempts to reopen a dropped socket; the last repeats. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [250, 500, 1_000, 2_000, 5_000];

/**
 * How often an open socket says it is still there. Under Cloudflare's ~100s idle
 * cut-off with room to spare, and it doubles as this end's check on the server:
 * a whole interval with nothing heard back means the connection is dead, however
 * open the browser thinks it is, and it is dropped and reopened.
 */
export const DEFAULT_KEEP_ALIVE_MS = 25_000;

/**
 * The part of a WebSocket this uses. A browser's, Node's and a Cloudflare Worker's
 * all have it, though their type declarations differ elsewhere — so this names
 * only what is used, and any of them, or a test's fake, fits.
 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((message: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type SocketConstructor = new (url: string) => SocketLike;

/** `WebSocket.OPEN`, the same in every implementation. */
const OPEN = 1;

export interface TransportOptions {
  readonly retryDelaysMs?: readonly number[];
  readonly keepAliveMs?: number;
  /** Injected for tests; the global by default. */
  readonly WebSocket?: SocketConstructor;
  readonly fetch?: typeof fetch;
}

/**
 * A connection to the game server at `baseUrl` — an `http(s)://` origin, or the
 * empty string for the page's own origin.
 */
export function connect(baseUrl: string, options: TransportOptions = {}): TableSocket {
  return new TableSocket(baseUrl, options);
}

export class TableSocket {
  /** Whether requests can be expected to reach the server. */
  connected = true;

  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pending = new Map<number, (result: Ack<unknown>) => void>();
  private readonly retryDelaysMs: readonly number[];
  private readonly keepAliveMs: number;
  private readonly WebSocketImpl: SocketConstructor;
  private readonly fetchImpl: typeof fetch;
  private nextId = 1;
  /** The table this client is at, if any. */
  private roomId: string | null = null;
  private ws: SocketLike | null = null;
  /** Frames waiting for the socket to open. */
  private queue: string[] = [];
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  /** Whether anything has arrived since the last keep-alive went out. */
  private heard = true;
  private closed = false;

  constructor(
    private readonly baseUrl: string,
    options: TransportOptions,
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS;
    this.WebSocketImpl =
      options.WebSocket ?? (globalThis.WebSocket as unknown as SocketConstructor);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    // As Socket.io did: say "connected" once, after whoever built this has had the
    // chance to listen for it. A listener attached later still misses it, so it
    // should read `connected` when it attaches (as `attachSession` does).
    setTimeout(() => {
      if (!this.closed && this.connected) this.fire("connect");
    }, 0);
  }

  on<E extends keyof SocketEvents>(event: E, handler: SocketEvents[E]): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as Listener);
    this.listeners.set(event, set);
    return this;
  }

  off<E extends keyof SocketEvents>(event: E, handler: SocketEvents[E]): this {
    this.listeners.get(event)?.delete(handler as Listener);
    return this;
  }

  once<E extends keyof SocketEvents>(event: E, handler: SocketEvents[E]): this {
    const wrapped = ((payload?: unknown) => {
      this.off(event, wrapped as SocketEvents[E]);
      (handler as Listener)(payload);
    }) as SocketEvents[E];
    return this.on(event, wrapped);
  }

  /**
   * Send a request; its last argument is the callback that receives the reply.
   * Typed from the shared contract, so a wrong payload is a compile error.
   */
  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): this {
    const ack = args[args.length - 1] as (result: Ack<unknown>) => void;
    const payload = args.length > 1 ? args[0] : undefined;
    void this.request(event, payload).then(ack);
    return this;
  }

  /** Close for good. No reconnecting, and no events after this. */
  close(): void {
    this.closed = true;
    this.connected = false;
    this.leaveTable();
  }

  /** Socket.io's name for the same thing, which the tests were written with. */
  disconnect(): void {
    this.close();
  }

  /**
   * Drop the table socket as a network failure would, leaving it to reconnect.
   * Only for tests: it is how a blip or a server restart is simulated.
   */
  dropConnection(): void {
    this.ws?.close();
  }

  // ---------------------------------------------------------------- requests ---

  private async request(event: string, payload: unknown): Promise<Ack<unknown>> {
    switch (event) {
      case "createRoom":
        return this.sit(ROOMS_PATH, payload);
      case "joinRoom": {
        // Everything but the code goes in the body: the name, and the identity and
        // picture when there are any.
        const { roomId, ...body } = payload as { roomId: string };
        return this.sit(joinPath(roomId), body);
      }
      case "resumeSeat": {
        const credentials = payload as SeatCredentials;
        this.goTo(credentials.roomId);
        const resumed = await this.send(event, payload);
        // No seat at that table after all: stop holding a socket to it.
        if (!resumed.ok && resumed.error !== NOT_SEATED) this.leaveTable();
        return resumed;
      }
      case "watchRoom": {
        // Watching is a socket at the table like a player's, holding no seat.
        this.goTo((payload as { roomId: string }).roomId);
        const watched = await this.send(event, payload);
        if (!watched.ok) this.leaveTable();
        return watched;
      }
      case "playAgain": {
        const moved = (await this.send(event, payload)) as Ack<SeatCredentials>;
        if (moved.ok) return this.claim(moved.data);
        return moved;
      }
      case "leaveRoom": {
        const left = await this.send(event, payload);
        // Whatever the server said, this client is getting up from the table.
        this.leaveTable();
        return left;
      }
      default:
        return this.send(event, payload);
    }
  }

  /**
   * Open or join a table over HTTP, then hold its socket and present the new seat
   * on it — which is what makes the seat this connection's, as creating or joining
   * over a Socket.io connection did.
   */
  private async sit(path: string, body: unknown): Promise<Ack<unknown>> {
    let seated: Ack<SeatCredentials>;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      seated = (await response.json()) as Ack<SeatCredentials>;
    } catch {
      // Unreachable: say nothing, as an unanswered socket request would, and let the
      // caller's own timeout report it.
      return new Promise(() => {});
    }
    if (!seated.ok) return seated;
    return this.claim(seated.data);
  }

  /** Move to a seat's table and present its token there. */
  private async claim(credentials: SeatCredentials): Promise<Ack<unknown>> {
    this.goTo(credentials.roomId);
    const claimed = await this.send("resumeSeat", credentials);
    return claimed.ok ? { ok: true, data: claimed.data } : claimed;
  }

  /** Send one frame over the table socket, resolving with the server's reply. */
  private send(event: string, payload: unknown): Promise<Ack<unknown>> {
    if (this.roomId === null || this.closed) {
      return Promise.resolve({ ok: false, error: NOT_SEATED });
    }
    const id = this.nextId++;
    const frame: ClientFrame = payload === undefined ? { id, event } : { id, event, payload };
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      const text = JSON.stringify(frame);
      if (this.ws?.readyState === OPEN) this.ws.send(text);
      else this.queue.push(text);
    });
  }

  // ------------------------------------------------------------------ socket ---

  /** Hold a socket to this table, dropping one to any other. */
  private goTo(roomId: string): void {
    if (this.roomId === roomId && this.ws) return;
    this.leaveTable();
    this.roomId = roomId;
    this.open();
  }

  /** Let go of the table socket on purpose: no reconnect, no `disconnect` event. */
  private leaveTable(): void {
    this.roomId = null;
    this.queue = [];
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopKeepAlive();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onopen = null;
      ws.onerror = null;
      ws.close();
    }
  }

  private open(): void {
    const roomId = this.roomId;
    /* v8 ignore next -- only ever called with a table to open */
    if (roomId === null) return;
    const url = `${this.socketBase()}${socketPath(roomId)}`;
    const ws = new this.WebSocketImpl(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.startKeepAlive(ws);
      for (const text of this.queue.splice(0)) ws.send(text);
      if (!this.connected) {
        this.connected = true;
        this.fire("connect");
      }
    };
    ws.onmessage = (message) => {
      this.heard = true;
      this.receive(String(message.data));
    };
    ws.onclose = () => this.dropped();
  }

  private startKeepAlive(ws: SocketLike): void {
    this.heard = true;
    this.keepAlive = setInterval(() => {
      if (this.heard) {
        this.heard = false;
        ws.send(PING);
        return;
      }
      // Silent for a whole interval: gone, whatever the socket says. Let go of
      // it without waiting for a close that may never come, and reconnect.
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
      this.dropped();
    }, this.keepAliveMs);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  /** The socket went away without being asked to: say so, and try again. */
  private dropped(): void {
    // Only the live socket can get here: one let go of on purpose has its
    // handlers removed first, so its closing says nothing.
    this.ws = null;
    this.stopKeepAlive();
    if (this.connected) {
      this.connected = false;
      this.fire("disconnect");
    }
    const delay =
      this.retryDelaysMs[Math.min(this.retries, this.retryDelaysMs.length - 1)] ?? 1_000;
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // Leaving the table or closing cancels this timer, so there is still a table.
      this.open();
    }, delay);
  }

  private receive(text: string): void {
    if (text === PONG) return;
    let frame: ServerFrame;
    try {
      frame = JSON.parse(text) as ServerFrame;
    } catch {
      return;
    }
    if (isAckFrame(frame)) {
      const resolve = this.pending.get(frame.ack);
      this.pending.delete(frame.ack);
      resolve?.(frame.result);
      return;
    }
    this.fire(frame.event, frame.payload);
  }

  private fire(event: string, payload?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload);
  }

  /** `http://host` becomes `ws://host`; an empty base means this page's own host. */
  private socketBase(): string {
    // Read loosely: Node has no `location`, and packages compiled without the DOM
    // types do not know the name.
    const page = (globalThis as { location?: { origin?: string } }).location;
    const base = this.baseUrl || page?.origin || "";
    return base.replace(/^http/, "ws");
  }
}
