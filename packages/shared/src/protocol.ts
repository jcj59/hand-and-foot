// The client/server contract: what crosses the socket, in both directions.
//
// It lives in the shared package rather than in the server so that the client
// compiles against exactly the same shapes, and a change to either side that
// breaks the other surfaces as a type error instead of a runtime surprise.
//
// Everything here is a transport concern. The game state itself is not in this
// file: the server sends a `PlayerView` produced by the engine's projection,
// which is the anti-cheat boundary, and these types only wrap it.

import type { Action, PlayerView, RoundScore, RulesConfig } from "./index";

/** Where an action in the log came from. */
export type ActionSource = "player" | "timeout" | "disconnect";

/**
 * One entry in a room's append-only action log.
 *
 * `source` is deliberately recorded even though replay ignores it: a move the
 * server played on a timed-out or disconnected player is not a demonstration of
 * anyone's intent, and the agent work needs to be able to filter those out
 * rather than learn to imitate a timeout.
 */
export interface LoggedAction {
  /** Position in the log, from 0, contiguous within a room. */
  readonly seq: number;
  /** The seat the action was applied to (not necessarily who submitted it). */
  readonly seat: number;
  readonly action: Action;
  readonly source: ActionSource;
  /** Server wall-clock at the time it was accepted. */
  readonly at: number;
}

/** Where a turn's clock stands, as the client needs to render it. */
export interface ClockState {
  /**
   * Server wall-clock at the moment this update was sent. Clients compute an
   * offset against their own clock once and anchor to it, rather than counting
   * down a remaining-milliseconds figure that drifts a little further on every
   * update.
   */
  readonly serverNow: number;
  /** Absolute server time the current window expires; null when paused or not started. */
  readonly deadlineAt: number | null;
  /** True once the main clock has run out and only a discard will be accepted. */
  readonly inDiscardGrace: boolean;
  /** Frozen because a player paused the table. */
  readonly paused: boolean;
}

/** What everyone at the table can see about one seat, outside the game state. */
export interface RoomPlayerInfo {
  readonly seat: number;
  readonly name: string;
  readonly connected: boolean;
}

/** Lobby- and room-level facts, none of them secret. */
export interface RoomInfo {
  readonly roomId: string;
  readonly players: readonly RoomPlayerInfo[];
  /** The seat allowed to start the game. */
  readonly hostSeat: number;
  readonly started: boolean;
  /** Seat that paused the table, when paused. */
  readonly pausedBy?: number;
  readonly config: RulesConfig;
}

/** The per-player broadcast: one of these goes to each socket after every accepted action. */
export interface ViewUpdate {
  readonly view: PlayerView;
  readonly clock: ClockState;
  readonly room: RoomInfo;
}

/** Sent once when a round finishes, to every seat. */
export interface RoundEnded {
  readonly scores: readonly RoundScore[];
  /** Seat that went out, if anyone did; the stock running out ends a round with nobody out. */
  readonly wentOutSeat?: number;
}

/**
 * The result of a request. Rule violations are rejections, not errors: the
 * engine returns them as values, and they travel the same way, so a client
 * never has to distinguish "illegal move" from "something broke".
 */
export type Ack<T = undefined> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/**
 * Issued when a player first joins and presented to reclaim their seat after a
 * disconnect. It is a bearer token for one seat in one room: whoever holds it
 * is that player, so it must never appear in a `RoomInfo` or any broadcast.
 */
export interface SeatCredentials {
  readonly roomId: string;
  readonly seat: number;
  readonly token: string;
}

export interface ClientToServerEvents {
  /**
   * Rooms always start with `defaultConfig`. Per-room rules selection is
   * deliberately deferred to the configurable rules editor (DESIGN.md
   * roadmap item 2), where the room creator will choose them with a real UI
   * and validation — don't reintroduce a client-supplied config here before
   * that lands.
   */
  createRoom: (
    payload: { readonly name: string },
    ack: (result: Ack<SeatCredentials>) => void,
  ) => void;
  joinRoom: (
    payload: { readonly roomId: string; readonly name: string },
    ack: (result: Ack<SeatCredentials>) => void,
  ) => void;
  /** Reclaim a seat after a disconnect, using the token issued on join. */
  resumeSeat: (payload: SeatCredentials, ack: (result: Ack) => void) => void;
  startGame: (ack: (result: Ack) => void) => void;
  submitAction: (action: Action, ack: (result: Ack) => void) => void;
  setPaused: (payload: { readonly paused: boolean }, ack: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  /** Per-socket: the sending seat's own filtered view. */
  view: (update: ViewUpdate) => void;
  /** Broadcast: lobby membership, connection state, pause state. */
  room: (info: RoomInfo) => void;
  roundEnded: (result: RoundEnded) => void;
}
