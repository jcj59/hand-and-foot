import {
  CARRIED_ON_WITHOUT_YOU,
  defaultAvatar,
  MAX_PLAYERS,
  MIN_PLAYERS,
  isReactionId,
  type Action,
  type ActionSource,
  type Avatar,
  type ClockState,
  type CloseReason,
  type GameState,
  type LastMove,
  type MatchRecord,
  type MeldPlay,
  type Reaction,
  type RoomInfo,
  type RoundEnded,
  type RulesConfig,
  type ViewUpdate,
} from "@hf/shared";
import {
  applyAction,
  deal,
  firstSeatFor,
  defaultAction,
  heuristicPolicy,
  describeMove,
  grabbyPants,
  isMatchOver,
  isSeated,
  legalHints,
  moveSeenBy,
  project,
  roundResult,
  seatedCount,
  summarizeMatch,
} from "@hf/engine";
import type { Clock } from "./clock";
import { ReactionLimiter } from "./reactions";
import { type ActionLog, InMemoryActionLog, StoredActionLog } from "./log";
import type { RoomRecord, RoomStore, StoredRoom } from "./store";

/** The engine will deal any number of seats; a game of Hand and Foot will not. */
// Defined in `@hf/shared` so the client can say "a table seats at most eight"
// without a second copy of the number. Re-exported for existing importers.
export { MAX_PLAYERS, MIN_PLAYERS };

/**
 * Ceiling on forced moves the server will play in one go. A turn is at most
 * draw, settle the pile obligation, discard, so three is the real bound; the
 * margin exists only so a future rule change turns into a stuck turn we can see
 * rather than a loop that pins a core.
 */
const MAX_FORCED_MOVES_PER_TURN = 40;

/**
 * How long a computer player takes over each move: long enough that the people at
 * the table can see what it did — a draw, a lay-down, a discard — one at a time,
 * as they would watch a person play, and short enough not to keep them waiting.
 */
export const BOT_MOVE_MS = 1_200;

/** Names for the computer players a host adds, in the order they are handed out. */
export const BOT_NAMES = [
  "Robo Rita",
  "Robo Ray",
  "Robo Rosa",
  "Robo Rex",
  "Robo Ruby",
  "Robo Rudy",
  "Robo Rhea",
] as const;

/**
 * The move a computer plays for a seat: the heuristic, given only that seat's view,
 * and the safe default should it ever have nothing to offer.
 */
function botMove(state: GameState, seat: number): Action | null {
  return heuristicPolicy(state, seat) ?? defaultAction(state);
}

/**
 * Ceiling on how many staged groups the timeout will search combinations of. A
 * lay-down has one group per rank, so real play stays far below this; the cap only
 * bounds the search against a payload built to be large.
 */
const MAX_DRAFT_GROUPS = 10;

/**
 * Whether an untyped value has the shape of a staged lay-down: a list of groups,
 * each a rank and a list of card ids. The draft arrives as JSON from a browser and
 * is played later inside a timer, where a malformed group would throw rather than
 * be refused — so a draft that is not this shape is no draft at all.
 */
export function isDraft(value: unknown): value is readonly MeldPlay[] {
  return (
    Array.isArray(value) &&
    value.every(
      (meld: unknown) =>
        typeof meld === "object" &&
        meld !== null &&
        typeof (meld as MeldPlay).rank === "string" &&
        Array.isArray((meld as MeldPlay).cardIds) &&
        (meld as MeldPlay).cardIds.every((id: unknown) => typeof id === "string"),
    )
  );
}

export interface RoomPlayer {
  /**
   * Position at the table. Stable once dealt; in the lobby a departure closes the
   * gap, so anything that has to survive that keys on `token` instead.
   */
  seat: number;
  readonly name: string;
  /**
   * Bearer credential for this seat, used to reclaim it after a disconnect.
   * It never leaves the server except in the ack to the player who owns it, and
   * it must never reach `RoomInfo`, which is broadcast to the whole table.
   */
  readonly token: string;
  connected: boolean;
  /**
   * The identity of whoever sat down, when their browser proved one; see `users.ts`.
   * Who they are, for attributing games later — never what they may do here, which
   * is the token's.
   */
  readonly userId?: string;
  /** The picture they sat down with, if they chose one. Public: it is in `RoomInfo`. */
  readonly avatar?: Avatar;
  /**
   * A computer player the host added. It has a token like anyone, which never
   * leaves the server; it is always connected and always ready, and the server
   * plays its moves with the heuristic.
   */
  readonly bot?: true;
  /** When they dropped, so the reconnect grace can be measured. Null while connected. */
  disconnectedAt: number | null;
  /**
   * Walked away from a dealt game on purpose. Such a seat is played for at once
   * rather than after the reconnect grace — nobody is coming back to it — until
   * the same token resumes it.
   */
  left: boolean;
}

/** Who is sitting down, beyond the name: what their browser proved, and the picture they chose. */
export interface SeatProfile {
  readonly userId?: string | null;
  readonly avatar?: Avatar | null;
}

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): RoomResult<T> {
  return { ok: false, error };
}
function succeed<T>(value: T): RoomResult<T> {
  return { ok: true, value };
}

export interface RoomDeps {
  readonly clock: Clock;
  readonly seed: number;
  readonly newToken: () => string;
  readonly log?: ActionLog;
  /**
   * How long a dropped player keeps their clock before the server starts moving
   * for them. Not a rule of the game, so it is not in `RulesConfig`.
   */
  readonly reconnectGraceMs?: number;
  /**
   * Whether a table pauses itself once a whole lap goes by with nobody playing;
   * on by default. Off only for tests of the clock, which let the server play
   * every seat for many turns on purpose.
   */
  readonly pauseWhenIdle?: boolean;
  /** Where the room's record and log are kept so a restart can bring it back. */
  readonly store?: RoomStore;
  /** The room's identity in the store; see `RoomRecord.uid`. Defaults to its code. */
  readonly uid?: string;
  /** When it was opened. Given only when restoring a room opened before a restart. */
  readonly createdAt?: number;
  /**
   * Keep a match for the people who played it: called once when the last round
   * ends, and by the host when a table closes part way through (`recordUnfinished`).
   * Only for a match somebody played under an identity — nobody could ask for any
   * other. The host decides where it goes; see `MatchStore`.
   */
  readonly recordMatch?: (record: MatchRecord) => void;
}

export const DEFAULT_RECONNECT_GRACE_MS = 30_000;

/**
 * How long a paused table is kept before it is closed. A pause is for a break,
 * not an ending: a table left paused all morning is a game nobody is coming back
 * to, and every open table holds its code and, while anyone's tab is open, the
 * host's resources.
 */
export const PAUSED_TABLE_MS = 30 * 60_000;

/** How long a paused family table saved for later is kept. */
export const SAVED_TABLE_MS = 7 * 24 * 60 * 60_000;

/** Why a table is closing, and when. */
export interface Closing {
  readonly at: number;
  readonly reason: CloseReason;
}

/**
 * One table: its seats, its authoritative game state, its clock, and its log.
 *
 * The room never trusts a submitted state, only a submitted *action*, which it
 * validates through the engine before anything changes. Everything a client sees
 * of the game comes from `project()`, so a bug here cannot leak a hidden card —
 * the worst it can do is show a player too little.
 *
 * It is also the only place that knows what time it is. The engine is a pure
 * reducer, so all pacing lives here, and every timeout produces an ordinary
 * `Action` fed through the same `applyAction` a player's move goes through.
 * A forced move is a real move; it just has a different `source` in the log.
 *
 * Transport lives in `socket.ts`; this class has no idea sockets exist, which is
 * what lets the whole game be driven directly in tests and, later, headlessly by
 * the agent.
 */
export class Room {
  readonly id: string;
  readonly uid: string;
  readonly config: RulesConfig;
  readonly log: ActionLog;
  /** When the room was opened, so one nobody ever joined can still be reaped. */
  readonly createdAt: number;

  /** Set by the transport so a move the *server* plays still reaches the table. */
  onChange: (() => void) | null = null;

  /**
   * The waiting room for the next game, once someone at this finished table has
   * asked to play again. Everyone after them joins the same one. Saved with the
   * record, so a table that restarts or sleeps still sends them to the same one.
   */
  get nextRoomId(): string | null {
    return this.next;
  }

  set nextRoomId(roomId: string | null) {
    this.next = roomId;
    this.save();
  }

  private next: string | null = null;

  private readonly deps: RoomDeps;
  private readonly reconnectGraceMs: number;
  private readonly players: RoomPlayer[] = [];
  /**
   * Who hosts, by token rather than seat: the host is a person, and handing the
   * table to someone else should not move anyone's seat. Null only for a room
   * nobody has joined.
   */
  private hostToken: string | null = null;
  /** Tokens of the players who went on to the next game's waiting room. */
  private readonly wentOn = new Set<string>();
  /** Tokens of the players ready for the next round, once a round has ended. */
  private readonly ready = new Set<string>();
  private state: GameState | null = null;
  private pausedSeat: number | undefined;
  /**
   * The lay-down the seat on turn is building but has not played; see
   * `stageMelds`. Only ever the current turn's, so it is dropped when the turn
   * moves on and never outlives the process — a restart loses nothing a player
   * committed to.
   */
  private draft: { readonly seat: number; readonly melds: readonly MeldPlay[] } | null = null;

  // --- turn clock ---
  /** When the turn on the clock began, already shifted forward by any pause. */
  private turnStartedAt: number | null = null;
  /** Increment earned so far this turn, before the cap is applied. */
  private accruedMs = 0;
  /** The seat whose turn the clock is currently measuring. */
  private clockSeat: number | null = null;
  /** Set once the main clock has run out and only a discard is still wanted. */
  private graceUntil: number | null = null;
  private pausedAt: number | null = null;
  private cancelTimer: (() => void) | null = null;

  // --- keeping the table open ---
  /** Paused by the table itself, for want of anyone playing, rather than a player. */
  private idlePaused = false;
  /**
   * When the current pause began, for its time limit. Unlike `pausedAt`, which
   * only does the clock's bookkeeping and restarts with the process, this is
   * saved, so a restart or a Durable Object waking does not give a paused table a
   * fresh half hour every time.
   */
  private pausedSince: number | null = null;
  /** Set while a paused table is saved for later: when it stops being kept. */
  private savedUntil: number | null = null;
  /** Turns played for their seats in a row, with nobody at the table moving. */
  private idleTurns = 0;
  /** Each seat's budget of quick reactions; see `react`. */
  private readonly reactionLimit: ReactionLimiter;
  private reactionSeq = 0;
  /** The latest move, for views; see `noteMove`. Not saved: it is only news. */
  private lastMove: LastMove | null = null;

  constructor(id: string, config: RulesConfig, deps: RoomDeps) {
    this.id = id;
    this.uid = deps.uid ?? id;
    this.config = config;
    this.deps = deps;
    this.reconnectGraceMs = deps.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    const log = deps.log ?? new InMemoryActionLog();
    this.log = deps.store ? new StoredActionLog(log, deps.store, this.uid) : log;
    this.createdAt = deps.createdAt ?? deps.clock.now();
    this.reactionLimit = new ReactionLimiter(deps.clock);
  }

  /**
   * Bring back a room saved before a restart, by replaying its log over a fresh
   * deal from the same seed.
   *
   * Everything the record and the log claim is checked rather than trusted, and a
   * room that does not add up is refused whole: a game rebuilt from a log with a
   * gap in it, or one the current engine no longer accepts, would be a different
   * game from the one its players were in, and dealing them into it would be worse
   * than telling them it is gone.
   *
   * What cannot come back is anything about time or connections. Every seat
   * returns disconnected, because no socket survived, with its reconnect grace
   * starting now; and the turn on the clock starts afresh, since how much of it
   * was used before the restart died with the process. A paused table stays
   * paused. Until someone resumes a seat the room is abandoned, so it runs no
   * clock, and the reaper takes it if nobody comes back.
   */
  static restore(
    stored: StoredRoom,
    deps: Omit<RoomDeps, "seed" | "uid" | "createdAt" | "log">,
  ): RoomResult<Room> {
    const { room: record, actions } = stored;
    if (record.players.some((p, index) => p.seat !== index)) {
      return fail(`room ${record.id}: seats are not numbered 0..n-1`);
    }
    if (actions.some((row, index) => row.seq !== index)) {
      return fail(`room ${record.id}: the action log has a gap or is out of order`);
    }
    if (!record.started && actions.length > 0) {
      return fail(`room ${record.id}: actions recorded for a table that never dealt`);
    }
    if (record.pausedSeat !== null && !record.players[record.pausedSeat]) {
      return fail(`room ${record.id}: paused by a seat that does not exist`);
    }

    let state: GameState | null = null;
    if (record.started) {
      const firstSeat = record.firstSeat ?? 0;
      if (!Number.isInteger(firstSeat) || firstSeat < 0 || firstSeat >= record.players.length) {
        return fail(`room ${record.id}: started by a seat that does not exist`);
      }
      state = deal(record.players.length, record.config, record.seed, 1, firstSeat);
      for (const row of actions) {
        if (row.seat !== state.currentSeat) {
          return fail(`room ${record.id}: action ${row.seq} is out of turn`);
        }
        const result = applyAction(state, row.action);
        if (!result.ok)
          return fail(`room ${record.id}: action ${row.seq} replays as refused: ${result.error}`);
        state = result.state;
      }
    }

    const room = new Room(record.id, record.config, {
      ...deps,
      seed: record.seed,
      uid: record.uid,
      createdAt: record.createdAt,
      log: new InMemoryActionLog(actions),
    });
    const now = deps.clock.now();
    for (const seat of record.players) {
      // A computer player is back the moment its table is: it never had a socket.
      room.players.push(
        seat.bot
          ? { ...seat, connected: true, disconnectedAt: null }
          : { ...seat, connected: false, disconnectedAt: now },
      );
    }
    // Rooms saved before hosting could be handed on have no host recorded; the
    // first seat hosted them.
    room.hostToken = record.hostToken ?? record.players[0]?.token ?? null;
    for (const token of record.nextRoundReady ?? []) room.ready.add(token);
    for (const token of record.wentOn ?? []) room.wentOn.add(token);
    room.next = record.nextRoomId ?? null;
    if (record.pausedSeat !== null) room.pausedSeat = record.pausedSeat;
    room.idlePaused = record.idlePaused ?? false;
    if (room.paused) {
      room.pausedAt = now;
      room.pausedSince = record.pausedSince ?? now;
      room.savedUntil = record.savedUntil ?? null;
    }
    room.state = state;
    if (state && !state.roundEnded) room.beginTurn(state.currentSeat);
    return succeed(room);
  }

  /** The part of the room a restart needs besides its log. */
  record(): RoomRecord {
    return {
      uid: this.uid,
      id: this.id,
      config: this.config,
      seed: this.deps.seed,
      createdAt: this.createdAt,
      players: this.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        token: p.token,
        left: p.left,
        ...(p.userId ? { userId: p.userId } : {}),
        ...(p.avatar ? { avatar: p.avatar } : {}),
        ...(p.bot ? { bot: true as const } : {}),
      })),
      started: this.started,
      ...(this.state ? { firstSeat: this.state.firstSeat ?? 0 } : {}),
      pausedSeat: this.pausedSeat ?? null,
      hostToken: this.hostToken,
      // What the table is waiting on between rounds and after the match, so a
      // restart — or a Durable Object waking — does not forget who said what.
      nextRoundReady: [...this.ready],
      wentOn: [...this.wentOn],
      nextRoomId: this.next,
      idlePaused: this.idlePaused,
      pausedSince: this.pausedSince,
      savedUntil: this.savedUntil,
    };
  }

  /** Write the record behind the game; see `RoomStore`. */
  private save(): void {
    this.deps.store?.saveRoom(this.record());
  }

  get started(): boolean {
    return this.state !== null;
  }

  /** Whether the table is saved for later, waiting for its players to come back. */
  get saved(): boolean {
    return this.savedUntil !== null;
  }

  /**
   * A saved game is picked back up by its host, once they can see who has come
   * back for it — not by whoever happens to return first, which would start the
   * clock on everyone still on their way. A host who has not come back cannot
   * hold the game hostage, though: then anyone at the table may.
   */
  private mayResumeSaved(seat: number): boolean {
    if (!this.saved) return true;
    return seat === this.hostSeat || !this.players[this.hostSeat]?.connected;
  }

  get paused(): boolean {
    return this.pausedSeat !== undefined || this.idlePaused;
  }

  /**
   * When this table should be closed, and why, if nothing changes before then:
   * paused and never resumed, or with everyone gone. `abandonedMs` is the host's
   * setting for the second. Null while the table is open indefinitely.
   *
   * A paused table goes by its pause, whoever is still connected: a tab left open
   * on a paused table is not somebody playing. One saved for later is kept for
   * days, and is not closed for being empty, since everyone leaving is the point.
   */
  closing(abandonedMs: number): Closing | null {
    const pauseEnds = this.pauseEndsAt();
    if (pauseEnds !== null) {
      return { at: pauseEnds, reason: this.savedUntil !== null ? "saved" : "paused" };
    }
    const since = this.abandonedSince;
    return since === null ? null : { at: since + abandonedMs, reason: "abandoned" };
  }

  private pauseEndsAt(): number | null {
    if (!this.paused) return null;
    if (this.savedUntil !== null) return this.savedUntil;
    /* v8 ignore next -- a paused table always knows when its pause began */
    return (this.pausedSince ?? this.deps.clock.now()) + PAUSED_TABLE_MS;
  }

  get seatCount(): number {
    return this.players.length;
  }

  get gameState(): GameState | null {
    return this.state;
  }

  seats(): readonly RoomPlayer[] {
    return this.players;
  }

  seatOf(token: string): RoomPlayer | undefined {
    return this.players.find((p) => p.token === token);
  }

  /** True once every seat has dropped — the signal for the manager to reap it. */
  get abandoned(): boolean {
    const people = this.people();
    return people.length > 0 && people.every((p) => !p.connected);
  }

  /** The seats people sit in, not computer players: the ones a table is kept open for. */
  private people(): RoomPlayer[] {
    return this.players.filter((p) => !p.bot);
  }

  /**
   * When the room became empty of live players, or null while someone is still
   * here. An empty room falls back to when it was opened, so a code that was
   * generated and never used is reaped on the same schedule.
   */
  get abandonedSince(): number | null {
    // A table of nobody, or of computer players alone, is as good as never used.
    if (this.people().length === 0) return this.createdAt;
    if (!this.abandoned) return null;
    // The last person to leave is when the room actually went quiet. Every person
    // is disconnected here, so every one of them carries a timestamp.
    /* v8 ignore next */
    return this.people().reduce((latest, p) => Math.max(latest, p.disconnectedAt ?? 0), 0);
  }

  join(name: string, { userId, avatar }: SeatProfile = {}): RoomResult<RoomPlayer> {
    if (this.started) return fail("the game has already started");
    if (this.players.length >= MAX_PLAYERS) return fail(`a table seats at most ${MAX_PLAYERS}`);
    const player: RoomPlayer = {
      seat: this.players.length,
      name,
      token: this.deps.newToken(),
      ...(userId ? { userId } : {}),
      ...(avatar ? { avatar } : {}),
      connected: true,
      disconnectedAt: null,
      left: false,
    };
    this.players.push(player);
    // Whoever opens the table hosts it until they hand it on.
    this.hostToken ??= player.token;
    this.save();
    return succeed(player);
  }

  /**
   * Sit a computer player at the table, so a person can play alone or fill a short
   * table. The host's to do, before the deal, while there is a seat free. It takes
   * the first name not already at the table and the picture drawn from that name.
   */
  addBot(bySeat: number): RoomResult<RoomPlayer> {
    if (this.started) return fail("computer players can only be added before the deal");
    if (bySeat !== this.hostSeat) return fail("only the host can add a computer player");
    if (this.players.length >= MAX_PLAYERS) return fail(`a table seats at most ${MAX_PLAYERS}`);
    const taken = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Robo ${this.players.length + 1}`;
    const bot: RoomPlayer = {
      seat: this.players.length,
      name,
      token: this.deps.newToken(),
      avatar: defaultAvatar(name),
      bot: true,
      connected: true,
      disconnectedAt: null,
      left: false,
    };
    this.players.push(bot);
    this.save();
    return succeed(bot);
  }

  /** Take a computer player away before the deal; the seats after it close up, as for a leave. */
  removeBot(bySeat: number, seat: number): RoomResult<RoomPlayer> {
    if (this.started) return fail("computer players can only be taken away before the deal");
    if (bySeat !== this.hostSeat) return fail("only the host can take a computer player away");
    const bot = this.players[seat];
    if (!bot?.bot) return fail("there is no computer player in that seat");
    return this.leave(bot.token);
  }

  /**
   * Give up a seat on purpose.
   *
   * Before the deal the seat is removed outright and the ones after it close up,
   * because `deal` seats exactly `players.length` players and a gap would be dealt
   * a hand nobody holds. The first seat hosts, so a departing host hands the table
   * to whoever is next in line. After the deal the seat stays and is treated as a
   * disconnect whose grace has already run out: the default policy plays it
   * straight away instead of stalling the table. At a family table that lasts only
   * until the round is over — then the player is taken out of the match and the
   * rest carry on without them (see `removeLeavers`), which between rounds is at
   * once.
   */
  leave(token: string): RoomResult<RoomPlayer> {
    const player = this.seatOf(token);
    if (!player) return fail("that seat token does not belong to this room");
    if (!this.started) {
      const pauser = this.pausedSeat === undefined ? undefined : this.players[this.pausedSeat];
      this.players.splice(this.players.indexOf(player), 1);
      this.players.forEach((p, index) => {
        p.seat = index;
      });
      // The pause belongs to a player, not a number: it follows its holder to
      // their new seat, and goes with them if they are the one leaving, since
      // nobody else is holding it.
      if (pauser === player) this.unpause();
      else if (pauser) this.pausedSeat = pauser.seat;
      // A departing host hands the table to whoever is now first in line — a
      // person, since a computer player cannot deal or carry on without anyone.
      if (this.hostToken === player.token) this.hostToken = this.people()[0]?.token ?? null;
      this.save();
      return succeed(player);
    }
    // Everyone leaving a saved game is the point of saving it: they are coming
    // back, so the seat is only empty, not given up. A seat marked left would be
    // played the moment the game resumed, rather than given a reconnect grace.
    if (this.saved) {
      this.setConnected(player.seat, false);
      return succeed(player);
    }
    player.left = true;
    this.ready.delete(player.token);
    this.setConnected(player.seat, false);
    this.removeLeavers();
    this.save();
    // The others may have been waiting only on this player to start the next round.
    this.dealNextRoundIfReady();
    return succeed(player);
  }

  /**
   * Carry on without a player who has gone, between rounds of a family game: the
   * host's call, for someone who is not coming back. Only someone not at the table
   * — a player still connected leaves for themselves — and never the host, who
   * leaves the same way. The engine has the rest of the say: between rounds, at a
   * family table, and never below two players.
   */
  removePlayer(bySeat: number, seat: number): RoomResult<undefined> {
    const state = this.state;
    if (!state) return fail("the game has not started");
    if (bySeat !== this.hostSeat) return fail("only the host can carry on without a player");
    const player = this.players[seat];
    if (!player || !isSeated(state, seat)) return fail("there is no such player");
    if (seat === bySeat) return fail("to leave the game yourself, leave the table");
    // A computer player is always at the table, and the host may still let it go.
    if (player.connected && !player.bot) return fail(`${player.name} is still at the table`);
    const removed = this.remove(seat);
    if (!removed.ok) return removed;
    this.save();
    // Everyone else may have been waiting only on this player to start the next round.
    this.dealNextRoundIfReady();
    return succeed(undefined);
  }

  /**
   * Take a player out of the match: the engine's `removePlayer`, logged as the
   * table's action like `nextRound`, so a restart replays the smaller table. The
   * seat keeps its number and its token, but the token no longer resumes it, and
   * whatever the player held — readiness, the pause, hosting — passes on or lapses.
   */
  private remove(seat: number): RoomResult<undefined> {
    const state = this.state;
    /* v8 ignore next -- callers check for state first */
    if (!state) return fail("the game has not started");
    const action: Action = { type: "removePlayer", seat };
    const removed = applyAction(state, action);
    if (!removed.ok) return fail(removed.error);
    this.state = removed.state;
    this.log.append(state.currentSeat, action, "player", this.deps.clock.now());
    const player = this.players[seat]!;
    this.ready.delete(player.token);
    player.left = true;
    if (player.connected) this.setConnected(seat, false);
    if (this.hostToken === player.token) {
      // Hosting passes to the next player on from them who is still playing.
      const candidates = this.people().filter((p) => isSeated(removed.state, p.seat));
      const next = candidates.find((p) => p.seat > seat) ?? candidates[0];
      // A table left with only computer players keeps its host: nobody can act on it.
      if (next) this.hostToken = next.token;
    }
    // A pause belongs to the player who made it; it goes with them, as it does when
    // someone leaves the lobby. Not a saved game's: that pause is the whole table's.
    if (this.pausedSeat === seat && !this.saved) this.unpause();
    return succeed(undefined);
  }

  /**
   * Take every player who walked away from a family game out of the match, once
   * the round they left in is over, so the next round is dealt without them rather
   * than played for them by the default policy. Nothing happens mid-round, at a
   * competitive table, or once it would leave too few players: there a player who
   * left goes on being played for, as before.
   */
  private removeLeavers(): boolean {
    if (!this.state?.roundEnded) return false;
    let removed = false;
    for (const player of this.players) {
      if (player.left && isSeated(this.state, player.seat)) {
        removed = this.remove(player.seat).ok || removed;
      }
    }
    return removed;
  }

  /**
   * Leave this finished table for the next game's waiting room. Recorded so the
   * players still here can see who has gone on, and otherwise a leave like any
   * other.
   */
  moveOn(token: string): RoomResult<RoomPlayer> {
    if (!this.matchOver) return fail("the match is not over yet");
    const left = this.leave(token);
    if (left.ok) {
      this.wentOn.add(token);
      this.save();
    }
    return left;
  }

  /**
   * Who a rematch brings to the next table, in their seats' order: everyone still in
   * the match who has not already gone on, computer players included. The host's to
   * ask for, once the match is over, and only while nobody has opened the next
   * game's table yet — after that, players join it one by one with play again.
   */
  rematchPlayers(bySeat: number): RoomResult<readonly RoomPlayer[]> {
    const state = this.state;
    if (!state || !isMatchOver(state)) return fail("the match is not over yet");
    if (bySeat !== this.hostSeat) return fail("only the host can start a rematch");
    if (this.next !== null) {
      return fail("someone has already gone on to a new game; play again to join them");
    }
    const coming = this.players.filter(
      (p) => isSeated(state, p.seat) && !this.wentOn.has(p.token) && !(p.left && !p.bot),
    );
    if (coming.length < MIN_PLAYERS) return fail(`a game needs at least ${MIN_PLAYERS} players`);
    return succeed(coming);
  }

  /** Whether this player has already left for the next game's table. */
  hasGoneOn(token: string): boolean {
    return this.wentOn.has(token);
  }

  /**
   * Say this player is ready for the next round. It is dealt the moment everyone
   * still at the table is — no one is dealt in while still reading the scores — and
   * a player who has left is not waited for. Returns whether this was the one that
   * dealt it.
   */
  readyForNextRound(seat: number): RoomResult<boolean> {
    if (!this.state?.roundEnded) return fail("the round is still being played");
    if (this.matchOver) return fail("that was the last round");
    if (this.saved) return fail("the game is saved; the host picks it back up");
    const player = this.players[seat];
    /* v8 ignore next -- the transport only ever passes a seat it assigned */
    if (!player) return fail("no such seat");
    this.ready.add(player.token);
    this.save();
    return succeed(this.dealNextRoundIfReady());
  }

  private dealNextRoundIfReady(): boolean {
    const state = this.state;
    if (!state?.roundEnded || this.matchOver) return false;
    // A player taken out of the match is always marked left too, and a computer
    // player is always ready.
    const staying = this.players.filter((p) => !p.left && !p.bot);
    if (!staying.every((p) => this.ready.has(p.token))) return false;
    // An ordinary action, logged like any other, so a restart replays the match
    // across its rounds.
    const dealt = applyAction(state, { type: "nextRound" });
    /* v8 ignore next -- the checks above are exactly the ones nextRound makes */
    if (!dealt.ok) return false;
    this.log.append(state.currentSeat, { type: "nextRound" }, "player", this.deps.clock.now());
    this.ready.clear();
    // A new deal has no latest move; the last round's is not news in this one.
    this.lastMove = null;
    this.save();
    this.draft = null;
    this.idleTurns = 0;
    this.state = dealt.state;
    this.beginTurn(dealt.state.currentSeat);
    return true;
  }

  /** Reclaim a seat after dropping off. Idempotent: rejoining twice is not an error. */
  resume(token: string): RoomResult<RoomPlayer> {
    const player = this.seatOf(token);
    if (!player) return fail("that seat token does not belong to this room");
    if (this.state && !isSeated(this.state, player.seat)) {
      return fail(CARRIED_ON_WITHOUT_YOU);
    }
    const cameBack = player.left;
    player.left = false;
    this.setConnected(player.seat, true);
    // Only `left` is recorded; a plain reconnect changes nothing a restart keeps.
    if (cameBack) this.save();
    return succeed(player);
  }

  setConnected(seat: number, connected: boolean): void {
    const player = this.players[seat];
    /* v8 ignore next -- the transport only ever reports a seat it assigned */
    if (!player) return;
    player.connected = connected;
    player.disconnectedAt = connected ? null : this.deps.clock.now();
    // Coming back mid-turn restores a normal clock; dropping may make the seat
    // eligible for immediate defaults, which `rearm` decides.
    this.rearm();
  }

  start(seat: number): RoomResult<GameState> {
    if (this.started) return fail("the game has already started");
    if (seat !== this.hostSeat) return fail("only the host can start the game");
    if (this.players.length < MIN_PLAYERS) {
      return fail(`a game needs at least ${MIN_PLAYERS} players`);
    }
    // Whoever opened the table used to go first every time; now the seed picks.
    this.state = deal(
      this.players.length,
      this.config,
      this.deps.seed,
      1,
      firstSeatFor(this.deps.seed, this.players.length),
    );
    this.save();
    this.beginTurn(this.state.currentSeat);
    return succeed(this.state);
  }

  /**
   * The seat allowed to deal. The first player to join hosts until they hand it
   * on; a host who leaves the lobby passes it to the first seat.
   */
  get hostSeat(): number {
    return this.players.find((p) => p.token === this.hostToken)?.seat ?? 0;
  }

  /**
   * Hand hosting to another player. Only the host may, and only before the deal:
   * dealing is the one thing a host does, so afterwards there is nothing to hand on.
   */
  setHost(bySeat: number, toSeat: number): RoomResult<undefined> {
    if (this.started) return fail("the host can only be changed before the deal");
    if (bySeat !== this.hostSeat) return fail("only the host can hand hosting to someone else");
    const target = this.players[toSeat];
    if (!target) return fail("no such seat");
    if (target.bot) return fail("a computer player cannot host");
    this.hostToken = target.token;
    this.save();
    return succeed(undefined);
  }

  setPaused(seat: number, paused: boolean): RoomResult<undefined> {
    // A table that paused itself can be resumed at any table, competitive ones
    // included: nobody chose to pause it, so nobody is using a pause they are not
    // allowed.
    const resumingIdle = !paused && this.idlePaused;
    if (!this.config.pauseEnabled && !resumingIdle) return fail("pausing is disabled in this mode");
    if (!this.players[seat]) return fail("no such seat");
    if (paused && this.paused) return fail("the table is already paused");
    if (!paused && !this.paused) return fail("the table is not paused");
    if (!paused && !this.mayResumeSaved(seat)) {
      return fail("only the host can pick a saved game back up");
    }
    // Any player may pause, including the one on the clock, and any player may
    // resume — a deliberate family-mode choice rather than an oversight. It makes
    // the turn cap soft here and hard in competitive play, where pausing is off.
    if (paused) {
      this.pausedSeat = seat;
      this.pausedAt = this.deps.clock.now();
      this.pausedSince = this.pausedAt;
      this.rearm();
    } else {
      this.unpause();
    }
    this.save();
    return succeed(undefined);
  }

  private unpause(): void {
    // Give back exactly the time the table stood still, so a pause costs the
    // player on the clock nothing — and a dropped player nothing either. A
    // family table often pauses precisely to wait for someone who dropped;
    // leaving their reconnect grace running would have the server play their
    // turns the instant the table resumed.
    const now = this.deps.clock.now();
    // `pausedAt` is set whenever the table is paused, and it is paused here.
    /* v8 ignore next */
    const frozenFor = this.pausedAt === null ? 0 : now - this.pausedAt;
    if (this.turnStartedAt !== null) this.turnStartedAt += frozenFor;
    if (this.graceUntil !== null) this.graceUntil += frozenFor;
    for (const player of this.players) {
      if (player.disconnectedAt === null) continue;
      // Only the part of the drop that overlapped the pause was frozen: someone
      // who dropped mid-pause starts their grace at the resume, never later.
      player.disconnectedAt = Math.min(player.disconnectedAt + frozenFor, now);
    }
    this.pausedSeat = undefined;
    this.pausedAt = null;
    this.idlePaused = false;
    this.pausedSince = null;
    this.savedUntil = null;
    this.idleTurns = 0;
    this.rearm();
  }

  /**
   * A quick reaction from a seat, to be shown to everyone. Only the fixed set, and
   * only so many: it is ephemeral, so it touches nothing in the game, the log, or
   * the record. Its number is `max(previous + 1, now)` on the room's clock rather
   * than a count from one, because nothing about it is saved: a Durable Object
   * that hibernates and wakes builds a fresh `Room`, and a counter restarting at
   * one would hand out numbers screens have already seen, so they would drop them.
   */
  react(seat: number, id: unknown): RoomResult<Reaction> {
    if (!this.players[seat]) return fail("no such seat");
    if (!isReactionId(id)) return fail("that is not a reaction");
    if (!this.reactionLimit.take(seat)) return fail("too many reactions; wait a moment");
    this.reactionSeq = Math.max(this.reactionSeq + 1, this.deps.clock.now());
    return succeed({ seq: this.reactionSeq, seat, id });
  }

  /**
   * Keep this table for days rather than minutes, so the game can be picked up
   * again another time — in the middle of a turn or between rounds. A table that
   * is not paused yet is paused by the same request, since a game being put away
   * must not have its clock running meanwhile. Family tables only, as pausing is;
   * resuming ends it.
   *
   * Readiness for the next round is forgotten: whoever comes back days later
   * should see the scores again and say ready afresh, rather than have the round
   * dealt around them.
   */
  saveForLater(seat: number): RoomResult<undefined> {
    if (!this.config.pauseEnabled) return fail("saving a game for later is for family games");
    if (!this.players[seat]) return fail("no such seat");
    if (!this.started) return fail("the game has not started");
    if (this.matchOver) return fail("the game is over; there is nothing to save");
    if (!this.paused) {
      this.pausedSeat = seat;
      this.pausedAt = this.deps.clock.now();
      this.pausedSince = this.pausedAt;
      this.rearm();
    }
    this.savedUntil = this.deps.clock.now() + SAVED_TABLE_MS;
    this.ready.clear();
    this.save();
    return succeed(undefined);
  }

  /**
   * Nobody has played for a whole lap: every seat's turn in a row was played for
   * it. Pause rather than go on playing a game nobody is watching — which would
   * never end, since the default policy never melds — and let the pause's time
   * limit close it if nobody comes back.
   */
  private pauseForIdleness(): void {
    this.idlePaused = true;
    this.pausedAt = this.deps.clock.now();
    this.pausedSince = this.pausedAt;
    this.rearm();
    this.save();
  }

  /**
   * Record the lay-down a player is building, so that if their clock runs out it
   * can be played for them rather than lost. Accepted only from the seat on turn,
   * in the play phase, while melding is still open; anything else is refused and
   * nothing is kept.
   */
  stageMelds(seat: number, melds: readonly MeldPlay[]): RoomResult<undefined> {
    const state = this.state;
    if (!state || state.roundEnded) return fail("there is no hand in play");
    if (seat !== state.currentSeat) return fail("it is not your turn");
    if (state.phase !== "play") return fail("melds can only be staged after drawing");
    if (this.graceUntil !== null) return fail("your turn is out of time: you can only discard");
    this.draft = isDraft(melds) && melds.length > 0 ? { seat, melds } : null;
    return succeed(undefined);
  }

  /**
   * Validate and apply one action. A rule violation comes back as a rejection
   * rather than an exception, because it is an ordinary outcome the client has
   * to render, not a failure of the server.
   */
  submitAction(
    seat: number,
    action: Action,
    source: ActionSource = "player",
  ): RoomResult<undefined> {
    const state = this.state;
    if (!state) return fail("the game has not started");
    if (this.paused) return fail("the table is paused");
    if (seat !== state.currentSeat) return fail("it is not your turn");
    // The next round is dealt by `readyForNextRound` once the whole table is ready;
    // taken as an ordinary move it would let one player skip everyone else's ready.
    if (action.type === "nextRound") {
      return fail("the next round is dealt when everyone is ready");
    }
    // Nor is taking a player out of the match anyone's move: see `leave` and `removePlayer`.
    if (action.type === "removePlayer") return fail("players leave the game by leaving the table");
    // Once the main clock is gone the turn is being wound up: a discard ends it,
    // anything else would extend a turn that has already run past its cap.
    if (source === "player" && this.graceUntil !== null && action.type !== "discard") {
      return fail("your turn is out of time: you can only discard");
    }

    const result = applyAction(state, action);
    if (!result.ok) return fail(result.error);

    if (source === "player") this.idleTurns = 0;
    this.state = result.state;
    this.log.append(seat, action, source, this.deps.clock.now());
    this.noteMove(seat, action, state, result.state);
    this.afterAction(seat);
    return succeed(undefined);
  }

  /** Stop the clock. A reaped or finished room must not leave a timer behind. */
  dispose(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  // ---------------------------------------------------------------- clock ---

  /** Advance the clock bookkeeping after an accepted action. */
  private afterAction(seat: number): void {
    const state = this.state;
    /* v8 ignore next -- submitAction only calls this with state set */
    if (!state) return;
    if (state.roundEnded) {
      this.dispose();
      this.clockSeat = null;
      if (this.removeLeavers()) this.save();
      if (isMatchOver(state)) this.keepMatch();
      return;
    }
    if (state.currentSeat !== seat) {
      this.beginTurn(state.currentSeat);
      return;
    }
    // Still the same turn: reward the action with an increment. The cap makes
    // this safe to grant unconditionally — no amount of it can extend the turn
    // past `capMs`, which is why farming it needs no policing.
    this.accruedMs += this.config.timers.incrementMs;
    this.rearm();
  }

  private beginTurn(seat: number): void {
    this.draft = null;
    this.clockSeat = seat;
    this.turnStartedAt = this.deps.clock.now();
    this.accruedMs = 0;
    this.graceUntil = null;
    this.rearm();
  }

  /** Absolute time the current window closes, ignoring pause. */
  private deadline(): number | null {
    // Unreachable in practice: every caller checks the game has started, and
    // starting it runs `beginTurn`, which sets this.
    /* v8 ignore next */
    if (this.turnStartedAt === null) return null;
    if (this.graceUntil !== null) return this.graceUntil;
    const { baseMs, capMs } = this.config.timers;
    return this.turnStartedAt + Math.min(capMs, baseMs + this.accruedMs);
  }

  /**
   * Whether the seat on the clock has been gone long enough to stop waiting for.
   *
   * Keyed on `disconnectedAt` rather than the `connected` flag because the two
   * are set together and the timestamp is the one carrying the information.
   */
  private seatIsAbsent(seat: number): boolean {
    const player = this.players[seat];
    /* v8 ignore next -- currentSeat always indexes a real seat */
    if (!player) return false;
    if (player.left) return true;
    if (player.disconnectedAt === null) return false;
    return this.deps.clock.now() - player.disconnectedAt >= this.reconnectGraceMs;
  }

  private rearm(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const state = this.state;
    if (!state || state.roundEnded || this.paused || this.clockSeat === null) return;

    // Nobody is left to pace. Playing defaults for an empty table would spin at
    // zero delay forever — every seat is absent, so each forced turn re-arms
    // immediately, and the default policy never ends a round to stop it. Go
    // quiet instead and let the manager reap the room.
    if (this.abandoned) return;

    // A computer player moves at a person's pace, one move at a time, so the table
    // can follow what it does.
    if (this.players[state.currentSeat]?.bot) {
      this.cancelTimer = this.deps.clock.setTimer(BOT_MOVE_MS, () => this.playBotMove());
      return;
    }

    // A player who is known gone does not get their clock burned every round:
    // one dropout would otherwise make a six-player table unplayable.
    if (this.seatIsAbsent(state.currentSeat)) {
      this.cancelTimer = this.deps.clock.setTimer(0, () => this.forceTurn("disconnect"));
      return;
    }

    const deadline = this.deadline();
    /* v8 ignore next -- clockSeat and turnStartedAt are always set together */
    if (deadline === null) return;

    // A seat that has dropped but is still inside its reconnect grace needs a
    // wake-up when that grace runs out, not only when the turn clock expires.
    // Without it nothing re-checks, and an absent player holds the table for a
    // full turn clock instead of the much shorter grace.
    const player = this.players[state.currentSeat];
    const graceEndsAt =
      player && !player.connected && player.disconnectedAt !== null
        ? player.disconnectedAt + this.reconnectGraceMs
        : null;
    const wakeAt = graceEndsAt === null ? deadline : Math.min(deadline, graceEndsAt);

    const delay = Math.max(0, wakeAt - this.deps.clock.now());
    this.cancelTimer = this.deps.clock.setTimer(delay, () => this.onTick());
  }

  /**
   * One move by the computer player on turn, through the same path as a forced
   * move, then the next is scheduled by `rearm` as for any accepted action. Its
   * turn counts towards the table pausing itself: a lap of nothing but computer
   * players and played-for seats is a table nobody is watching.
   */
  private playBotMove(): void {
    this.cancelTimer = null;
    const state = this.state;
    /* v8 ignore next -- the timer is cancelled whenever the game stops being live */
    if (!state || state.roundEnded) return;
    const seat = state.currentSeat;
    const action = botMove(state, seat);
    /* v8 ignore next 2 -- the heuristic and the default are proven legal by the engine's property tests */
    if (action === null || !this.apply(seat, action, "bot")) {
      if (!this.applyFallback(seat)) return;
    }
    if (this.state?.currentSeat !== seat || this.state.roundEnded) this.afterForcedTurn();
    else this.notify();
  }

  /* v8 ignore next 6 -- only reached if the heuristic offered a move the reducer refused */
  private applyFallback(seat: number): boolean {
    const state = this.state;
    if (!state) return false;
    const action = defaultAction(state);
    return action !== null && this.apply(seat, action, "bot");
  }

  /** Whichever deadline came first has arrived; work out which one it was. */
  private onTick(): void {
    this.cancelTimer = null;
    const state = this.state;
    /* v8 ignore next -- the timer is cancelled whenever state goes away */
    if (!state || state.roundEnded) return;
    if (this.seatIsAbsent(state.currentSeat)) {
      this.forceTurn("disconnect");
      return;
    }
    this.onExpiry();
  }

  private onExpiry(): void {
    const state = this.state;
    /* v8 ignore next -- onTick has already established the game is live */
    if (!state || state.roundEnded) return;

    if (this.graceUntil === null) {
      // The main clock is gone. First, whatever the player had staged and not yet
      // played: they meant to play it, and losing it to the clock would be the
      // harshest reading of a timeout. Then bring the turn to the point where only
      // a discard is left — drawing, and settling any pile obligation, are not
      // choices the player still gets to make — and open the discard-only window
      // so they still pick their own card instead of having one picked for them.
      this.playDraft("timeout");
      this.playForcedUntilDiscardable("timeout");
      if (this.state?.roundEnded || this.state?.currentSeat !== state.currentSeat) {
        this.notify();
        return;
      }
      this.graceUntil = this.deps.clock.now() + this.config.timers.discardGraceMs;
      this.rearm();
      this.notify();
      return;
    }

    // The grace is gone too: play the discard for them.
    this.forceTurn("timeout");
  }

  /**
   * Play as much of the staged lay-down as the rules allow.
   *
   * The whole draft is tried first. If the engine refuses it — a group still two
   * cards short, a total below the minimum — the largest part it will accept is
   * played instead, trying every combination of whole groups from the most cards
   * down. A lay-down is at most a handful of groups, so that is a few dozen
   * attempts at the reducer, and it finds, say, the two finished groups of three
   * even when a third was still a pair. If nothing is acceptable, nothing is played.
   */
  private playDraft(source: ActionSource): void {
    const state = this.state;
    const draft = this.draft;
    this.draft = null;
    if (!state || !draft || draft.seat !== state.currentSeat || state.phase !== "play") return;
    const groups = draft.melds.slice(0, MAX_DRAFT_GROUPS);
    const subsets: (readonly MeldPlay[])[] = [];
    for (let mask = (1 << groups.length) - 1; mask > 0; mask--) {
      subsets.push(groups.filter((_, i) => mask & (1 << i)));
    }
    const size = (melds: readonly MeldPlay[]): number =>
      melds.reduce((n, meld) => n + meld.cardIds.length, 0);
    subsets.sort((a, b) => size(b) - size(a));
    for (const melds of subsets) {
      if (applyAction(state, { type: "playMelds", melds }).ok) {
        this.apply(state.currentSeat, { type: "playMelds", melds }, source);
        return;
      }
    }
  }

  /**
   * Play defaults up to the point a discard would end the turn, leaving the
   * discard itself to the player.
   */
  private playForcedUntilDiscardable(source: ActionSource): void {
    // The bound is a safety net, never the exit: winding a turn up to its
    // discard takes at most a draw plus one lay-down. Written as an explicit
    // guard rather than a loop condition so the never-taken branch is one line.
    let remaining = MAX_FORCED_MOVES_PER_TURN;
    for (;;) {
      /* v8 ignore next */
      if (remaining-- <= 0) return;
      const state = this.state;
      if (!state || state.roundEnded) return;
      const action = defaultAction(state);
      /* v8 ignore next -- defaultAction is total on every reachable live state */
      if (action === null) return;
      if (action.type === "discard") return;
      /* v8 ignore next -- the default is proven legal by the engine's property tests */
      if (!this.apply(state.currentSeat, action, source)) return;
      /* v8 ignore next -- winding up a turn cannot itself end it; only a discard can */
      if (this.state?.currentSeat !== state.currentSeat) return;
    }
  }

  /**
   * Play the whole of the current turn on the seat's behalf.
   *
   * The loop stops the moment the turn moves on or the round ends. Its other
   * exits are defensive: `defaultAction` is total on every reachable live state
   * and the move it returns is proven legal by the engine's property tests, so
   * those branches only fire if a future rule change breaks that guarantee — in
   * which case a stalled turn is a far better outcome than a spinning loop.
   */
  private forceTurn(source: ActionSource): void {
    const startedSeat = this.state?.currentSeat;
    // A player whose turn is taken from them — gone past their grace, or out of
    // time — keeps what they had staged, exactly as at the main clock's expiry.
    this.playDraft(source);
    for (let i = 0; i < MAX_FORCED_MOVES_PER_TURN; i++) {
      const state = this.state;
      /* v8 ignore next */
      if (!state || state.roundEnded) break;
      if (state.currentSeat !== startedSeat) break;
      // A player who has gone is played for properly, by the heuristic, so the
      // round they are part of still gets played; one who is only out of time keeps
      // the safe default, which commits them to nothing they did not choose.
      const action =
        source === "disconnect" ? botMove(state, state.currentSeat) : defaultAction(state);
      /* v8 ignore next */
      if (action === null) break;
      /* v8 ignore next */
      if (!this.apply(state.currentSeat, action, source)) break;
    }
    this.afterForcedTurn();
  }

  /** A turn nobody at the table played is over: count it, and pause after a whole lap of them. */
  private afterForcedTurn(): void {
    this.idleTurns++;
    const idle =
      this.deps.pauseWhenIdle !== false &&
      this.idleTurns >= (this.state ? seatedCount(this.state) : this.players.length);
    if (idle && this.state && !this.state.roundEnded) {
      this.pauseForIdleness();
    }
    this.notify();
  }

  /** Apply a server-played action, bypassing the turn and grace guards. */
  private apply(seat: number, action: Action, source: ActionSource): boolean {
    const state = this.state;
    /* v8 ignore next -- callers check for state first */
    if (!state) return false;
    const result = applyAction(state, action);
    /* v8 ignore next -- see the property tests behind defaultAction */
    if (!result.ok) return false;
    this.state = result.state;
    this.log.append(seat, action, source, this.deps.clock.now());
    this.noteMove(seat, action, state, result.state);
    this.afterAction(seat);
    return true;
  }

  /**
   * Remember what a move did, for the views that follow: the card a draw added to
   * the drawer's hand, the card a discard left on the pile, how many cards the pile
   * or a lay-down moved. Worked out from the states either side, so it cannot
   * disagree with what the engine actually did. Numbered by the move's place in the
   * action log, which is saved and replayed, so a number never repeats across a
   * restart or a Durable Object waking.
   */
  private noteMove(seat: number, action: Action, before: GameState, after: GameState): void {
    const move = describeMove(this.log.length, seat, action, before, after);
    if (move) this.lastMove = move;
  }

  private notify(): void {
    this.onChange?.();
  }

  /**
   * The clock as the client should render it: an absolute deadline plus the
   * server's own "now", so the client anchors one offset instead of counting
   * down a remaining figure that drifts further on every update.
   */
  clockState(): ClockState {
    const now = this.deps.clock.now();
    // While paused the deadline is meaningless — the clock is not running — so
    // send none rather than one that silently slides. Once the round has ended no
    // turn is live and nothing will fire, so a deadline would count down to nothing.
    const deadlineAt =
      this.paused || !this.started || this.state?.roundEnded ? null : this.deadline();
    return {
      serverNow: now,
      deadlineAt,
      inDiscardGrace: this.graceUntil !== null,
      paused: this.paused,
    };
  }

  info(): RoomInfo {
    return {
      roomId: this.id,
      // Mapped field by field rather than spread: a spread here would put every
      // seat's token on a payload that goes to the whole table.
      players: this.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        connected: p.connected,
        ...(p.avatar ? { avatar: p.avatar } : {}),
        ...(this.state && !isSeated(this.state, p.seat) ? { departed: true as const } : {}),
        ...(p.bot ? { bot: true as const } : {}),
      })),
      hostSeat: this.hostSeat,
      started: this.started,
      pausedBy: this.pausedSeat,
      idlePaused: this.idlePaused,
      savedUntil: this.savedUntil,
      closesAt: this.pauseEndsAt(),
      grabbyPants: grabbyPants(this.log.entries()),
      config: this.config,
      playAgain: this.players.filter((p) => this.wentOn.has(p.token)).map((p) => p.seat),
      nextRoundReady: this.players.filter((p) => this.ready.has(p.token)).map((p) => p.seat),
    };
  }

  /** The filtered update for one seat. Null before the game starts. */
  viewFor(seat: number): ViewUpdate | null {
    if (!this.state) return null;
    // A drawn card is its drawer's alone; everyone else is told only that one was.
    const lastMove = this.lastMove && moveSeenBy(this.lastMove, seat);
    return {
      ...(lastMove ? { lastMove } : {}),
      view: project(this.state, seat),
      clock: this.clockState(),
      room: this.info(),
      // Computed here because it needs the full state, which never leaves the
      // server. The alternative is a second copy of the legality rules in the
      // client, which would be free to disagree with the reducer.
      hints: legalHints(this.state, seat),
    };
  }

  /** Final scores, once the round is over. */
  result(): RoundEnded | null {
    return this.state && roundResult(this.state);
  }

  /**
   * The match as it is kept: who played it, the log that replays it, and its
   * summary. Null before the deal. The log is the room's own, which is what a
   * restart replays, so the record and the game cannot disagree.
   */
  matchRecord(): MatchRecord | null {
    const state = this.state;
    if (!state) return null;
    const entries = this.log.entries();
    const firstSeat = state.firstSeat ?? 0;
    return {
      id: this.uid,
      roomId: this.id,
      startedAt: entries[0]?.at ?? this.createdAt,
      endedAt: this.deps.clock.now(),
      config: this.config,
      seed: this.deps.seed,
      firstSeat,
      seats: this.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        ...(p.avatar ? { avatar: p.avatar } : {}),
        ...(p.userId ? { userId: p.userId } : {}),
        ...(p.bot ? { bot: true as const } : {}),
      })),
      log: entries.map((e) => ({ seat: e.seat, action: e.action, source: e.source })),
      summary: summarizeMatch({
        config: this.config,
        seed: this.deps.seed,
        playerCount: this.players.length,
        firstSeat,
        actions: entries.map((e) => e.action),
      }),
    };
  }

  /**
   * Keep a match that is closing before its last round, as far as it got. The host
   * calls this as it closes the table — reaped for being left, or paused too long —
   * since only the host knows a table is closing.
   */
  recordUnfinished(): void {
    if (this.started && !this.matchOver) this.keepMatch();
  }

  private keepMatch(): void {
    if (!this.deps.recordMatch) return;
    try {
      const record = this.matchRecord();
      if (!record || !record.seats.some((s) => s.userId && !s.bot)) return;
      this.deps.recordMatch(record);
    } catch (error) {
      console.error(`could not record match ${this.uid}:`, error);
    }
  }

  /** Whether the last round of the match has been played. */
  get matchOver(): boolean {
    return this.state !== null && isMatchOver(this.state);
  }
}
