// The client/server contract: what crosses the socket, in both directions.
//
// It lives in the shared package rather than in the server so that the client
// compiles against exactly the same shapes, and a change to either side that
// breaks the other surfaces as a type error instead of a runtime surprise.
//
// Everything here is a transport concern. The game state itself is not in this
// file: the server sends a `PlayerView` produced by the engine's projection,
// which is the anti-cheat boundary, and these types only wrap it.

import type { Action, GameMode, LegalHints, PlayerView, RoundScore, RulesConfig } from "./index";

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
  /**
   * Absolute server time the current window expires; null when paused, not
   * started, or once the round is over and no turn is live.
   */
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
  /**
   * Which kinds of move are open to this seat, computed by the server.
   *
   * The client cannot work this out for itself: `canTakePile` and `canGoOut` are
   * decided by predicates that read the whole `GameState`, and a client only ever
   * holds its own `PlayerView`. Sending the answer keeps one implementation of
   * legality — the reducer's — instead of a second, drifting copy in the UI. It
   * discloses nothing, since every field describes the seat's own cards and the
   * face-up discard pile.
   */
  readonly hints: LegalHints;
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

/** Rules preset a room is opened with. */
export type RulesPreset = "east-coast" | "west-coast";

/**
 * What the room creator chooses when opening a table.
 *
 * Both fields are optional and both are unions: omitting them gives the East
 * Coast family game this was built for. The set is deliberately small and
 * closed so the server can coerce an unrecognized value to a safe default
 * without a validator — this type only constrains callers TypeScript checks;
 * a value arriving over the wire is untyped JSON and is normalized on the
 * server rather than trusted. `mode` carries pausing with it — a competitive
 * table is exactly one where the clock cannot be stopped — so the two never
 * drift apart.
 */
export interface RoomOptions {
  readonly preset?: RulesPreset;
  readonly mode?: GameMode;
}

export interface ClientToServerEvents {
  /**
   * Open a new room. The creator picks the house rules here, because the table's
   * rules are settled before anyone sits down, not changed mid-game.
   *
   * Deliberately a small set of named choices rather than a `Partial<RulesConfig>`:
   * every field below is a union, so the server can normalize whatever arrives
   * over the wire to a known value without a validator to get wrong — the union
   * only constrains typed callers, not the untyped JSON a socket actually
   * delivers. The full rules surface gets exposed by the configurable rules
   * editor (DESIGN.md roadmap item 2), which is where arbitrary overrides
   * belong — don't widen this to a raw config.
   */
  createRoom: (
    payload: { readonly name: string; readonly options?: RoomOptions },
    ack: (result: Ack<SeatCredentials>) => void,
  ) => void;
  joinRoom: (
    payload: { readonly roomId: string; readonly name: string },
    ack: (result: Ack<SeatCredentials>) => void,
  ) => void;
  /**
   * Reclaim a seat after a disconnect, using the token issued on join.
   *
   * The ack carries the credentials back with the seat the server resolved from
   * the token. The stored `seat` can be stale — someone ahead of this player may
   * have left the lobby since — so the client takes the seat from here, never
   * from what it sent.
   */
  resumeSeat: (payload: SeatCredentials, ack: (result: Ack<SeatCredentials>) => void) => void;
  /**
   * Give up this socket's seat on purpose. In the lobby the seat is freed for
   * someone else and the seats behind it close up; once dealt, it is played for
   * by the server from then on, without waiting out the reconnect grace.
   */
  leaveRoom: (ack: (result: Ack) => void) => void;
  startGame: (ack: (result: Ack) => void) => void;
  submitAction: (action: Action, ack: (result: Ack) => void) => void;
  setPaused: (payload: { readonly paused: boolean }, ack: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  /** Per-socket: the sending seat's own filtered view. */
  view: (update: ViewUpdate) => void;
  /** Broadcast: lobby membership, connection state, pause state. */
  room: (info: RoomInfo) => void;
  /**
   * Per-socket: the seat this socket now holds, sent when someone ahead of it
   * left the lobby and the seats closed up. Without it a client would go on
   * treating its old number as its own — and as the host's, or someone else's.
   */
  seat: (seat: number) => void;
  roundEnded: (result: RoundEnded) => void;
}
