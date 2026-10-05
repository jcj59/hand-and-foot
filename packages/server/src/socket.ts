/**
 * The Node server's transport: HTTP for opening and joining tables, and one plain
 * WebSocket per seated client, on the paths in `@hf/shared/wire`.
 *
 * Everything a table does with its connections lives in `TableChannel`, which the
 * Cloudflare Worker drives too; this module only carries frames to and from it.
 */
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  HEALTH_PATH,
  parseAvatar,
  parseRoomPath,
  PING,
  PONG,
  ROOMS_PATH,
  USERS_PATH,
  CLAIM_PATH,
  MATCHES_PATH,
  PASSWORD_PATH,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
  MATCH_PATH,
  type Ack,
  type ClientFrame,
} from "@hf/shared";
import { nextTableFor, openTable, rematchFor, sitAt } from "./lobby";
import { InMemoryUserStore, registerUser, verifyUser, type UserStore } from "./users";
import {
  changePassword,
  claimUsername,
  InMemoryLoginStore,
  signIn,
  signOut,
  type AccountStores,
  type LoginStore,
} from "./accounts";
import { InMemoryMatchStore, matchHistory, matchReplay, type MatchStore } from "./matches";
import type { RoomManager } from "./manager";
import type { Room } from "./room";
import { refusal, TableChannel } from "./table";

export interface TransportOptions {
  /** Allowed browser origins; any when unset. */
  readonly cors?: readonly string[];
  /**
   * How often to check that each socket is still there. A client that vanishes
   * without closing — a laptop lid, a lost network — sends nothing to say so, and
   * without a check its seat would look occupied until the operating system gave
   * up on the connection, which can take many minutes.
   */
  readonly heartbeatMs?: number;
  /** Where identities are kept; in memory when unset. */
  readonly users?: UserStore;
  /** Where usernames are kept; in memory when unset. */
  readonly logins?: LoginStore;
  /** Where finished matches are kept; in memory when unset. */
  readonly matches?: MatchStore;
  /** The time an identity was registered or updated; the system clock when unset. */
  readonly now?: () => number;
}

export const DEFAULT_HEARTBEAT_MS = 25_000;

/** The largest request body read, well above any real one. */
const MAX_BODY_BYTES = 16 * 1024;

export interface Tables {
  /** The channel for a table, made on first use. */
  channelFor(room: Room): TableChannel;
  /** Stop the heartbeat and close every socket. */
  close(): void;
}

/**
 * Serve tables on `http`. Returns the handle `createServer` needs to find a table's
 * channel and to shut the sockets down.
 */
export function attachTables(
  http: HttpServer,
  manager: RoomManager,
  options: TransportOptions = {},
): Tables {
  const users = options.users ?? new InMemoryUserStore();
  const matches = options.matches ?? new InMemoryMatchStore();
  const accounts: AccountStores = { users, logins: options.logins ?? new InMemoryLoginStore() };
  const accountRoutes = {
    [CLAIM_PATH]: claimUsername,
    [SIGN_IN_PATH]: signIn,
    [PASSWORD_PATH]: changePassword,
    [SIGN_OUT_PATH]: signOut,
  } as const;
  const now = options.now ?? Date.now;
  const channels = new Map<string, TableChannel>();
  const channelFor = (room: Room): TableChannel => {
    const existing = channels.get(room.id);
    if (existing?.room === room) return existing;
    const channel = new TableChannel(room, {
      nextTable: async (from, player) => nextTableFor(manager, from, player),
      rematch: async (from, players) => rematchFor(manager, from, players),
    });
    channels.set(room.id, channel);
    return channel;
  };
  // A reaped room's channel goes with it, or it would be kept alive by the map.
  manager.onRemove = (room, reason) => {
    const channel = channels.get(room.id);
    if (channel?.room !== room) return;
    channels.delete(room.id);
    if (reason) channel.close(reason);
    else channel.retire();
  };

  const allowed = (origin: string | undefined): boolean =>
    !options.cors || origin === undefined || options.cors.includes(origin);

  http.on("request", (request, response) => {
    // Nothing a request does may take the process down with it: a store that fails
    // mid-request answers this one request with an error, and every table goes on.
    route(request, response).catch(() => {
      if (response.headersSent) return void response.end();
      json(response, 500, { ok: false, error: "the server could not answer that; try again" });
    });
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    // The client is served from another host in production, so the browser asks
    // first, and is told which origins may call.
    if (origin && allowed(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "origin");
    }
    const path = String(request.url).split("?")[0]!;
    if (request.method === "OPTIONS") {
      response.setHeader("access-control-allow-methods", "GET, POST");
      response.setHeader("access-control-allow-headers", "content-type");
      response.writeHead(204).end();
      return;
    }
    // A bare 200 is what a host's health check needs, and the room count is a cheap
    // sign of life when reading it by hand. The old path is kept for hosts already
    // configured to check it.
    if (request.method === "GET" && (path === HEALTH_PATH || path === "/healthz")) {
      return json(response, 200, { ok: true, rooms: manager.size });
    }
    if (request.method !== "POST") return void response.writeHead(404).end();
    if (!allowed(origin)) return void response.writeHead(403).end();

    const body = await readJson(request);
    if (body === null)
      return json(response, 400, { ok: false, error: "that request was not JSON" });
    if (path === USERS_PATH) {
      return json(response, 200, await registerUser(users, body, now()));
    }
    if (Object.hasOwn(accountRoutes, path)) {
      const handle = accountRoutes[path as keyof typeof accountRoutes];
      return json(response, 200, await handle(accounts, body, now()));
    }
    if (path === MATCHES_PATH) {
      return json(response, 200, await matchHistory(users, matches, body));
    }
    if (path === MATCH_PATH) {
      return json(response, 200, await matchReplay(users, matches, body));
    }
    // Who is sitting down, if their browser proved an identity (anonymous otherwise),
    // and their picture, if it is one (none otherwise; never a reason to refuse).
    const profile = {
      userId: await verifyUser(users, body.user),
      avatar: parseAvatar(body.avatar),
    };
    if (path === ROOMS_PATH) {
      return json(response, 200, openTable(manager, body.name, body.options, profile));
    }
    const target = parseRoomPath(path);
    if (target?.what === "join") {
      // No broadcast yet: the table hears of the newcomer when their socket claims
      // the seat, which is the moment they are actually there.
      return json(response, 200, sitAt(manager, target.roomId, body.name, profile));
    }
    response.writeHead(404).end();
  }

  const sockets = new WebSocketServer({ noServer: true });
  const alive = new WeakMap<WebSocket, boolean>();

  http.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const target = parseRoomPath(String(request.url).split("?")[0]!);
    if (target?.what !== "socket" || !allowed(request.headers.origin)) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const room = manager.get(target.roomId);
    sockets.handleUpgrade(request, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));
      // The client's own keep-alive, which it uses to notice a dead connection.
      ws.on("message", (data) => {
        if (String(data) === PING) ws.send(PONG);
      });
      // A code with no table behind it still gets a socket, so that what is asked
      // of it is answered — "no room with that code" sends a client home — rather
      // than left to time out while the client keeps trying to connect.
      if (!room) {
        ws.on("message", (data) => {
          const frame = parse(data);
          if (frame) ws.send(JSON.stringify({ ack: frame.id, result: refusal(frame.event) }));
        });
        return;
      }
      const channel = channelFor(room);
      const connection = channel.connect({ send: (frame) => ws.send(JSON.stringify(frame)) });
      ws.on("message", (data) => {
        const frame = parse(data);
        if (frame) void channel.handle(connection, frame);
      });
      ws.on("close", () => channel.disconnect(connection));
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      // No answer since the last ping: the other end is gone.
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  heartbeat.unref();

  return {
    channelFor,
    close() {
      clearInterval(heartbeat);
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
    },
  };
}

/** A request frame, or null for anything that is not one. */
function parse(data: unknown): ClientFrame | null {
  try {
    const frame = JSON.parse(String(data)) as ClientFrame;
    return typeof frame?.id === "number" && typeof frame.event === "string" ? frame : null;
  } catch {
    return null;
  }
}

function json(response: ServerResponse, status: number, body: Ack<unknown> | object): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** The request body as a JSON object, or null if it is not one or is too large. */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
