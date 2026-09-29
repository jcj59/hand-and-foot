// The wire: how the events in `protocol.ts` travel.
//
// A table is reached two ways. Opening one and sitting down at one are plain HTTP
// requests, because they happen before there is a table to be connected to. Once
// seated, a client holds one WebSocket to its table, and every other request and
// every broadcast goes over it as JSON frames. The same shapes serve the Node
// server and the Cloudflare Worker, so the client speaks one protocol to either.

import type { Ack } from "./protocol";

/**
 * A request from the client over the table socket. `id` pairs it with its reply,
 * as Socket.io's acknowledgement callbacks did.
 */
export interface ClientFrame {
  readonly id: number;
  readonly event: string;
  readonly payload?: unknown;
}

/** A reply to one request. */
export interface AckFrame {
  readonly ack: number;
  readonly result: Ack<unknown>;
}

/** Something the server pushes unasked: a view, the room, a seat change, a result. */
export interface EventFrame {
  readonly event: string;
  readonly payload: unknown;
}

export type ServerFrame = AckFrame | EventFrame;

/** Open a table and take its first seat: POST `{ name, options }`. */
export const ROOMS_PATH = "/api/rooms";

/** Sit down at an existing table: POST `{ name }`. */
export function joinPath(roomId: string): string {
  return `${ROOMS_PATH}/${encodeURIComponent(roomId)}/join`;
}

/** The table's socket. A connection there holds no seat until it sends `resumeSeat`. */
export function socketPath(roomId: string): string {
  return `${ROOMS_PATH}/${encodeURIComponent(roomId)}/socket`;
}

/** Whether the process is up, for a host's health check. */
export const HEALTH_PATH = "/api/healthz";

/**
 * Read a table code out of a request path, for the router on either server.
 * Returns the code and what is being asked of it, or null for anything else.
 */
export function parseRoomPath(
  path: string,
): { readonly roomId: string; readonly what: "join" | "socket" } | null {
  const match = /^\/api\/rooms\/([^/]+)\/(join|socket)$/.exec(path);
  if (!match) return null;
  return { roomId: decodeURIComponent(match[1]!), what: match[2] as "join" | "socket" };
}

/** Tell a reply from a push. */
export function isAckFrame(frame: ServerFrame): frame is AckFrame {
  return "ack" in frame;
}
