// The client/server contract: what crosses the socket, in both directions.
//
// It lives in the shared package rather than in the server so that the client
// compiles against exactly the same shapes, and a change to either side that
// breaks the other surfaces as a type error instead of a runtime surprise.
//
// Everything here is a transport concern. The game state itself is not in this
// file: the server sends a `PlayerView` produced by the engine's projection,
// which is the anti-cheat boundary, and these types only wrap it.

import type {
  MeldPlay,
  Action,
  Card,
  GameMode,
  LegalHints,
  PlayerView,
  RoundScore,
  RulesConfig,
} from "./index";

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

/** Who holds the Grabby Pants title, with the streak that earned or kept it. */
export interface GrabbyPants {
  readonly seat: number;
  /** The holder's best run of pile pickups, which a challenger has to beat. */
  readonly streak: number;
  /** Who held it before, when it was taken from someone. */
  readonly from?: number;
}

/** Lobby- and room-level facts, none of them secret. */
export interface RoomInfo {
  readonly roomId: string;
  readonly players: readonly RoomPlayerInfo[];
  /** The seat allowed to start the game. */
  readonly hostSeat: number;
  readonly started: boolean;
  /** Seat that paused the table, when a player paused it. */
  readonly pausedBy?: number;
  /** The table paused itself: a full lap of turns went by with nobody playing. */
  readonly idlePaused?: boolean;
  /** When a paused table was saved for later, the time it is kept until. */
  readonly savedUntil?: number | null;
  /**
   * When the table will be closed if nothing changes: paused and not resumed, or
   * with everyone gone. Server time, like the clock's deadline. Null while it is
   * open indefinitely.
   */
  readonly closesAt?: number | null;
  /** Whoever took the pile most times running this match, once someone has three. */
  readonly grabbyPants?: GrabbyPants | null;
  readonly config: RulesConfig;
  /** Seats that have gone on from this finished table to a new game's waiting room. */
  readonly playAgain: readonly number[];
  /** Seats that are ready for the next round of the match, once a round has ended. */
  readonly nextRoundReady: readonly number[];
}

/**
 * The move the table last saw, so a client can say it out loud — a toast for a
 * discard, a highlight on the card just drawn — rather than leave players to spot
 * a changed number.
 *
 * `card` is the discarded card (public: it is face up on the pile), or, for a
 * draw, the card drawn — which only the player who drew it is ever sent. Everyone
 * else learns that a card was drawn, not which.
 */
export interface LastMove {
  /** Increases with every move, so the same move arriving twice is not announced twice. */
  readonly seq: number;
  readonly seat: number;
  readonly kind: "draw" | "takePile" | "meld" | "takeBack" | "discard";
  readonly card?: Card;
  /** Cards taken with the pile, or played to melds. */
  readonly count?: number;
  /**
   * Set on a meld that got its player down only through the Marva rule — worth
   * less than the round minimum, allowed because it emptied the hand — which every
   * screen celebrates. Public: the lay-down is on the table for all to see.
   */
  readonly marva?: true;
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
  /** The table's latest move, as this seat may see it; absent before any. */
  readonly lastMove?: LastMove;
}

/** Sent once when a round finishes, to every seat. */
export interface RoundEnded {
  readonly scores: readonly RoundScore[];
  /** Which round of the match this was, from 1. */
  readonly roundNumber: number;
  /** Each seat's total over the match so far, this round included, in seat order. */
  readonly totals: readonly number[];
  /** Whether this was the last round: the match is over and the totals are final. */
  readonly matchOver: boolean;
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
  /** Hand hosting to the player in `seat`. Only the host may, and only before the deal. */
  setHost: (payload: { readonly seat: number }, ack: (result: Ack) => void) => void;
  submitAction: (action: Action, ack: (result: Ack) => void) => void;
  /**
   * Once the round is over, get up from this table and into a waiting room for a
   * new game with the same rules. The first to ask opens it and hosts it; everyone
   * after joins the same one. The ack carries the seat in the new room, as a join
   * does. Asking again on the same connection gets the same seat, not a second one.
   */
  playAgain: (ack: (result: Ack<SeatCredentials>) => void) => void;
  /**
   * Say this seat is ready for the next round of the match. It is dealt once
   * everyone still at the table is; the ack says whether this was the one that
   * dealt it.
   */
  nextRound: (ack: (result: Ack<boolean>) => void) => void;
  /**
   * The lay-down this seat is building but has not played, sent as it changes.
   *
   * Only so the server can play it for them if the turn clock runs out first: the
   * staging lives in the browser, and a timeout is exactly when the browser cannot
   * be relied on — backgrounded, asleep, or gone. It goes only to the server, is
   * forgotten when the turn ends, and is never shown to another seat. Ignored
   * outside the sender's own play phase.
   */
  stageMelds: (
    payload: { readonly melds: readonly MeldPlay[] },
    ack: (result: Ack) => void,
  ) => void;
  setPaused: (payload: { readonly paused: boolean }, ack: (result: Ack) => void) => void;
  /**
   * Send a quick reaction to everyone at the table. Only an id from `REACTIONS`;
   * refused when the seat has sent too many too quickly.
   */
  react: (payload: { readonly id: ReactionId }, ack: (result: Ack) => void) => void;
  /**
   * Keep a paused family table for days rather than minutes, so the game can be
   * picked up again later. Only while paused; resuming ends it.
   */
  saveForLater: (ack: (result: Ack) => void) => void;
}

/**
 * The quick reactions a seated player can send: a fixed set, so only an id ever
 * crosses the wire — never free text — and there is nothing to moderate. Each is
 * shown briefly by the sender's seat on every screen.
 */
export const REACTIONS = [
  { id: "thumbs-up", text: "👍", label: "Thumbs up" },
  { id: "laugh", text: "😂", label: "Laughing" },
  { id: "wow", text: "😮", label: "Wow" },
  { id: "angry", text: "😤", label: "Fuming" },
  { id: "party", text: "🎉", label: "Party" },
  { id: "pray", text: "🙏", label: "Please" },
  { id: "nice", text: "Nice!", label: "Nice!" },
  { id: "oops", text: "Oops", label: "Oops" },
  { id: "hurry", text: "Hurry up!", label: "Hurry up!" },
  { id: "grabby", text: "Grabby!", label: "Grabby!" },
  { id: "well-played", text: "Well played", label: "Well played" },
  { id: "good-luck", text: "Good luck", label: "Good luck" },
] as const;

export type ReactionId = (typeof REACTIONS)[number]["id"];

/** Whether an untyped value is one of the reactions — the server's check on what arrives. */
export function isReactionId(value: unknown): value is ReactionId {
  return REACTIONS.some((r) => r.id === value);
}

/** One reaction, as everyone at the table is told it. Never stored, never logged. */
export interface Reaction {
  /** Increases with each reaction at this table, so a screen can tell them apart. */
  readonly seq: number;
  readonly seat: number;
  readonly id: ReactionId;
}

/** Why a table was closed. */
export type CloseReason = "paused" | "saved" | "abandoned";

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
  /** Broadcast: a player's quick reaction, to show by their seat for a moment. */
  reaction: (reaction: Reaction) => void;
  /** Broadcast: the table has been closed, and why. Nothing more will come. */
  tableClosed: (payload: { readonly reason: CloseReason }) => void;
}
