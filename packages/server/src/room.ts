import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Action,
  type ActionSource,
  type ClockState,
  type GameState,
  type MeldPlay,
  type RoomInfo,
  type RoundEnded,
  type RulesConfig,
  type ViewUpdate,
} from "@hf/shared";
import { applyAction, deal, defaultAction, legalHints, project, scoreRound } from "@hf/engine";
import type { Clock } from "./clock";
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
const MAX_FORCED_MOVES_PER_TURN = 12;

/**
 * Ceiling on how many staged groups the timeout will search combinations of. A
 * lay-down has one group per rank, so real play stays far below this; the cap only
 * bounds the search against a payload built to be large.
 */
const MAX_DRAFT_GROUPS = 10;

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
  /** When they dropped, so the reconnect grace can be measured. Null while connected. */
  disconnectedAt: number | null;
  /**
   * Walked away from a dealt game on purpose. Such a seat is played for at once
   * rather than after the reconnect grace — nobody is coming back to it — until
   * the same token resumes it.
   */
  left: boolean;
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
  /** Where the room's record and log are kept so a restart can bring it back. */
  readonly store?: RoomStore;
  /** The room's identity in the store; see `RoomRecord.uid`. Defaults to its code. */
  readonly uid?: string;
  /** When it was opened. Given only when restoring a room opened before a restart. */
  readonly createdAt?: number;
  /** Seed for each game after the first, when the table plays again. */
  readonly newSeed?: () => number;
  /** Storage identity for each game after the first; see `RoomRecord.uid`. */
  readonly newUid?: () => string;
}

export const DEFAULT_RECONNECT_GRACE_MS = 30_000;

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
  readonly config: RulesConfig;
  /** When the room was opened, so one nobody ever joined can still be reaped. */
  readonly createdAt: number;

  /** Set by the transport so a move the *server* plays still reaches the table. */
  onChange: (() => void) | null = null;

  private readonly deps: RoomDeps;
  private readonly reconnectGraceMs: number;
  // A table that plays again starts a new game in the same room: a new seed, a
  // new log, and a new identity in storage, so each game replays on its own.
  private currentUid: string;
  private currentLog: ActionLog;
  private seed: number;
  /** Which game this is at the table, from 1. */
  private games = 1;
  /** Tokens of the players who have asked to play again after the round ended. */
  private readonly again = new Set<string>();
  private readonly players: RoomPlayer[] = [];
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

  constructor(id: string, config: RulesConfig, deps: RoomDeps) {
    this.id = id;
    this.currentUid = deps.uid ?? id;
    this.config = config;
    this.deps = deps;
    this.seed = deps.seed;
    this.reconnectGraceMs = deps.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    this.currentLog = this.logFor(deps.log ?? new InMemoryActionLog());
    this.createdAt = deps.createdAt ?? deps.clock.now();
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
      state = deal(record.players.length, record.config, record.seed);
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
      room.players.push({ ...seat, connected: false, disconnectedAt: now });
    }
    if (record.pausedSeat !== null) {
      room.pausedSeat = record.pausedSeat;
      room.pausedAt = now;
    }
    room.state = state;
    if (state && !state.roundEnded) room.beginTurn(state.currentSeat);
    return succeed(room);
  }

  /** The storage identity of the game being played; see `RoomRecord.uid`. */
  get uid(): string {
    return this.currentUid;
  }

  /** The current game's log. */
  get log(): ActionLog {
    return this.currentLog;
  }

  private logFor(inner: ActionLog): ActionLog {
    return this.deps.store ? new StoredActionLog(inner, this.deps.store, this.currentUid) : inner;
  }

  /** The part of the room a restart needs besides its log. */
  record(): RoomRecord {
    return {
      uid: this.uid,
      id: this.id,
      config: this.config,
      seed: this.seed,
      createdAt: this.createdAt,
      players: this.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        token: p.token,
        left: p.left,
      })),
      started: this.started,
      pausedSeat: this.pausedSeat ?? null,
    };
  }

  /** Write the record behind the game; see `RoomStore`. */
  private save(): void {
    this.deps.store?.saveRoom(this.record());
  }

  get started(): boolean {
    return this.state !== null;
  }

  get paused(): boolean {
    return this.pausedSeat !== undefined;
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
    return this.players.length > 0 && this.players.every((p) => !p.connected);
  }

  /**
   * When the room became empty of live players, or null while someone is still
   * here. An empty room falls back to when it was opened, so a code that was
   * generated and never used is reaped on the same schedule.
   */
  get abandonedSince(): number | null {
    if (this.players.length === 0) return this.createdAt;
    if (!this.abandoned) return null;
    // The last person to leave is when the room actually went quiet. Every seat
    // is disconnected here, so every one of them carries a timestamp.
    /* v8 ignore next */
    return this.players.reduce((latest, p) => Math.max(latest, p.disconnectedAt ?? 0), 0);
  }

  join(name: string): RoomResult<RoomPlayer> {
    if (this.started) return fail("the game has already started");
    if (this.players.length >= MAX_PLAYERS) return fail(`a table seats at most ${MAX_PLAYERS}`);
    const player: RoomPlayer = {
      seat: this.players.length,
      name,
      token: this.deps.newToken(),
      connected: true,
      disconnectedAt: null,
      left: false,
    };
    this.players.push(player);
    this.save();
    return succeed(player);
  }

  /**
   * Give up a seat on purpose.
   *
   * Before the deal the seat is removed outright and the ones after it close up,
   * because `deal` seats exactly `players.length` players and a gap would be dealt
   * a hand nobody holds. The first seat hosts, so a departing host hands the table
   * to whoever is next in line. After the deal the engine's player count is fixed,
   * so the seat stays and is treated as a disconnect whose grace has already run
   * out: the default policy plays it straight away instead of stalling the table.
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
      this.save();
      return succeed(player);
    }
    player.left = true;
    this.again.delete(player.token);
    this.setConnected(player.seat, false);
    this.save();
    // Everyone still at a finished table may have been waiting on this player.
    this.playAgainIfAgreed();
    return succeed(player);
  }

  /** Reclaim a seat after dropping off. Idempotent: rejoining twice is not an error. */
  resume(token: string): RoomResult<RoomPlayer> {
    const player = this.seatOf(token);
    if (!player) return fail("that seat token does not belong to this room");
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
    this.state = deal(this.players.length, this.config, this.seed);
    this.save();
    this.beginTurn(this.state.currentSeat);
    return succeed(this.state);
  }

  /**
   * The first seat hosts. A host who leaves the lobby passes it on without any
   * bookkeeping, because the seats behind them close up and the next becomes 0.
   */
  get hostSeat(): number {
    return 0;
  }

  setPaused(seat: number, paused: boolean): RoomResult<undefined> {
    if (!this.config.pauseEnabled) return fail("pausing is disabled in this mode");
    if (!this.players[seat]) return fail("no such seat");
    if (paused && this.paused) return fail("the table is already paused");
    if (!paused && !this.paused) return fail("the table is not paused");
    // Any player may pause, including the one on the clock, and any player may
    // resume — a deliberate family-mode choice rather than an oversight. It makes
    // the turn cap soft here and hard in competitive play, where pausing is off.
    if (paused) {
      this.pausedSeat = seat;
      this.pausedAt = this.deps.clock.now();
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
    this.rearm();
  }

  /**
   * Ask to play another game at this table, once the round is over.
   *
   * The new game is dealt the moment everyone still at the table has asked, with
   * the same players — anyone who left is dropped and the rest close up — and at
   * least the two a game needs. Until then the table shows who has asked. Returns
   * whether this request was the one that started it.
   */
  playAgain(seat: number): RoomResult<boolean> {
    if (!this.state?.roundEnded) return fail("the round is not over yet");
    const player = this.players[seat];
    /* v8 ignore next -- the transport only ever passes a seat it assigned */
    if (!player) return fail("no such seat");
    this.again.add(player.token);
    return succeed(this.playAgainIfAgreed());
  }

  /** Deal the next game if everyone still here has asked for it. */
  private playAgainIfAgreed(): boolean {
    if (!this.state?.roundEnded) return false;
    const staying = this.players.filter((p) => !p.left);
    if (staying.length < MIN_PLAYERS) return false;
    if (!staying.every((p) => this.again.has(p.token))) return false;

    // The finished game stays in storage, closed, as its own record; the next is new.
    this.deps.store?.closeRoom(this.currentUid, this.deps.clock.now());
    this.dispose();
    this.players.splice(0, this.players.length, ...staying);
    this.players.forEach((p, index) => {
      p.seat = index;
    });
    this.again.clear();
    this.games++;
    this.seed = this.deps.newSeed?.() ?? this.seed + 1;
    this.currentUid = this.deps.newUid?.() ?? `${this.id}#${this.games}`;
    this.currentLog = this.logFor(new InMemoryActionLog());
    this.pausedSeat = undefined;
    this.pausedAt = null;
    this.draft = null;
    this.clockSeat = null;
    this.state = deal(this.players.length, this.config, this.seed);
    this.save();
    this.beginTurn(this.state.currentSeat);
    return true;
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
    this.draft = melds.length > 0 ? { seat, melds } : null;
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
    // Once the main clock is gone the turn is being wound up: a discard ends it,
    // anything else would extend a turn that has already run past its cap.
    if (source === "player" && this.graceUntil !== null && action.type !== "discard") {
      return fail("your turn is out of time: you can only discard");
    }

    const result = applyAction(state, action);
    if (!result.ok) return fail(result.error);

    this.state = result.state;
    this.log.append(seat, action, source, this.deps.clock.now());
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
      const action = defaultAction(state);
      /* v8 ignore next */
      if (action === null) break;
      /* v8 ignore next */
      if (!this.apply(state.currentSeat, action, source)) break;
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
    this.afterAction(seat);
    return true;
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
      })),
      hostSeat: this.hostSeat,
      started: this.started,
      pausedBy: this.pausedSeat,
      config: this.config,
      gameNumber: this.games,
      playAgain: this.players.filter((p) => this.again.has(p.token)).map((p) => p.seat),
    };
  }

  /** The filtered update for one seat. Null before the game starts. */
  viewFor(seat: number): ViewUpdate | null {
    if (!this.state) return null;
    return {
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
    if (!this.state?.roundEnded) return null;
    return { scores: scoreRound(this.state), wentOutSeat: this.state.wentOutSeat };
  }
}
