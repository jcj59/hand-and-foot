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
  Departure,
  LegalHints,
  PlayerView,
  RoomOptions,
  RoundScore,
  RulesConfig,
  UserCredentials,
} from "./index";
import type { Avatar } from "./avatar";

/** Where an action in the log came from. */
export type ActionSource = "player" | "timeout" | "disconnect" | "bot";

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
  /** The picture they chose, if any; without one a seat is drawn from its name (`defaultAvatar`). */
  readonly avatar?: Avatar;
  /** A computer player the host added. Always at the table; absent for people. */
  readonly bot?: true;
  /**
   * Left the match between rounds: the seat is kept, for its scores, but no longer
   * plays. Absent for everyone still playing.
   */
  readonly departed?: true;
}

/** Who holds the Grabby Pants title, with the streak that earned or kept it. */
export interface GrabbyPants {
  readonly seat: number;
  /** The run of pile pickups that earned the title or last kept it: three or more. */
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
  /** Whoever last took the pile three times running this round, if anyone has. */
  readonly grabbyPants?: GrabbyPants | null;
  readonly config: RulesConfig;
  /** Seats that have gone on from this finished table to a new game's waiting room. */
  readonly playAgain: readonly number[];
  /** Seats that are ready for the next round of the match, once a round has ended. */
  readonly nextRoundReady: readonly number[];
  /** How many people are watching the table without a seat; absent when nobody is. */
  readonly watching?: number;
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
  /**
   * Players who have left the match, and after which round: a scoreboard shows
   * them as gone, and does not count them for the win. Absent when nobody has left.
   */
  readonly departed?: readonly Departure[];
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
   * Open a new room. The creator picks the house rules here, because the table's
   * rules are settled before anyone sits down, not changed mid-game: a preset, a
   * mode, and any changes to the preset's rules. Whatever arrives is untyped JSON
   * and the server checks all of it (`resolveRules`), refusing the table with the
   * reason rather than quietly playing something else.
   */
  createRoom: (
    payload: {
      readonly name: string;
      readonly options?: RoomOptions;
      /** Who is sitting down, if the browser has an identity; checked by the server. */
      readonly user?: UserCredentials;
      /** The player's picture, if they chose one; dropped by the server if it is not one. */
      readonly avatar?: Avatar;
    },
    ack: (result: Ack<SeatCredentials>) => void,
  ) => void;
  joinRoom: (
    payload: {
      readonly roomId: string;
      readonly name: string;
      readonly user?: UserCredentials;
      readonly avatar?: Avatar;
    },
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
   * by the server from then on, without waiting out the reconnect grace — at a
   * family table only until the round is over, when the rest carry on without
   * this player (at once, between rounds).
   */
  leaveRoom: (ack: (result: Ack) => void) => void;
  startGame: (ack: (result: Ack) => void) => void;
  /**
   * Watch a table without a seat: from then on this socket is sent what a spectator
   * may see — the room, the table with every hand hidden, the results — and can do
   * nothing at it. The ack is the room as it stands.
   */
  watchRoom: (payload: { readonly roomId: string }, ack: (result: Ack<RoomInfo>) => void) => void;
  /** Hand hosting to the player in `seat`. Only the host may, and only before the deal. */
  setHost: (payload: { readonly seat: number }, ack: (result: Ack) => void) => void;
  /**
   * Carry on without the player in `seat`, who has gone: between rounds of a family
   * game, by the host, for a player not at the table. From the next round the deal
   * is for the smaller table.
   */
  removePlayer: (payload: { readonly seat: number }, ack: (result: Ack) => void) => void;
  /** Sit a computer player at the table. Only the host may, and only before the deal. */
  addBot: (ack: (result: Ack) => void) => void;
  /** Take a computer player away again, before the deal. The host's call. */
  removeBot: (payload: { readonly seat: number }, ack: (result: Ack) => void) => void;
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
 *
 * Only ever add to it. An id may be in flight to a client loaded before the
 * change, or remembered by one, so removing or renaming one breaks a table. The
 * client tells a phrase from an emoji by whether its text is its own label.
 */
export const REACTIONS = [
  { id: "thumbs-up", text: "👍", label: "Thumbs up" },
  { id: "laugh", text: "😂", label: "Laughing" },
  { id: "wow", text: "😮", label: "Wow" },
  { id: "angry", text: "😤", label: "Fuming" },
  { id: "party", text: "🎉", label: "Party" },
  { id: "pray", text: "🙏", label: "Please" },
  { id: "grimace", text: "😬", label: "Grimacing" },
  { id: "cry", text: "😭", label: "Crying" },
  { id: "facepalm", text: "🤦", label: "Facepalm" },
  { id: "fingers-crossed", text: "🤞", label: "Fingers crossed" },
  { id: "fire", text: "🔥", label: "On fire" },
  { id: "cool", text: "😎", label: "Cool" },
  { id: "nice", text: "Nice!", label: "Nice!" },
  { id: "oops", text: "Oops", label: "Oops" },
  { id: "hurry", text: "Hurry up!", label: "Hurry up!" },
  { id: "grabby", text: "Grabby!", label: "Grabby!" },
  { id: "well-played", text: "Well played", label: "Well played" },
  { id: "good-luck", text: "Good luck", label: "Good luck" },
  { id: "oof", text: "Oof", label: "Oof" },
  { id: "ouch", text: "Ouch", label: "Ouch" },
  { id: "yikes", text: "Yikes", label: "Yikes" },
  { id: "phew", text: "Phew", label: "Phew" },
  { id: "ha", text: "Ha!", label: "Ha!" },
  { id: "close-one", text: "Close one", label: "Close one" },
  { id: "gg", text: "GG", label: "GG" },
] as const;

export type ReactionId = (typeof REACTIONS)[number]["id"];

/** Whether an untyped value is one of the reactions — the server's check on what arrives. */
export function isReactionId(value: unknown): value is ReactionId {
  return REACTIONS.some((r) => r.id === value);
}

/** One reaction, as everyone at the table is told it. Never stored, never logged. */
export interface Reaction {
  /**
   * Increases with each reaction at this table, so a screen can tell them apart —
   * across a server restart or a Durable Object waking too, which is why it is
   * taken from the clock (see `Room.react`) rather than counted from one.
   */
  readonly seq: number;
  readonly seat: number;
  readonly id: ReactionId;
}

/**
 * The refusal a player gets for a seat they no longer have because the match went
 * on without them — they left between rounds, or the host carried on without
 * them. Shared so the client can say so, rather than that the table has gone.
 */
export const CARRIED_ON_WITHOUT_YOU = "the game carried on without you";

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
