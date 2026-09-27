import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Action,
  type ActionSource,
  type ClockState,
  type GameState,
  type RoomInfo,
  type RoundEnded,
  type RulesConfig,
  type ViewUpdate,
} from "@hf/shared";
import { applyAction, deal, defaultAction, legalHints, project, scoreRound } from "@hf/engine";
import type { Clock } from "./clock";
import { type ActionLog, InMemoryActionLog } from "./log";

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

export interface RoomPlayer {
  readonly seat: number;
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
  readonly log: ActionLog;
  /** When the room was opened, so one nobody ever joined can still be reaped. */
  readonly createdAt: number;

  /** Set by the transport so a move the *server* plays still reaches the table. */
  onChange: (() => void) | null = null;

  private readonly deps: RoomDeps;
  private readonly reconnectGraceMs: number;
  private readonly players: RoomPlayer[] = [];
  private state: GameState | null = null;
  private pausedSeat: number | undefined;

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
    this.config = config;
    this.deps = deps;
    this.reconnectGraceMs = deps.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    this.log = deps.log ?? new InMemoryActionLog();
    this.createdAt = deps.clock.now();
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
    };
    this.players.push(player);
    return succeed(player);
  }

  /** Reclaim a seat after dropping off. Idempotent: rejoining twice is not an error. */
  resume(token: string): RoomResult<RoomPlayer> {
    const player = this.seatOf(token);
    if (!player) return fail("that seat token does not belong to this room");
    this.setConnected(player.seat, true);
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
    this.state = deal(this.players.length, this.config, this.deps.seed);
    this.beginTurn(this.state.currentSeat);
    return succeed(this.state);
  }

  /** The first seat to join hosts. Kept simple deliberately: no host migration yet. */
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
    } else {
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
    }
    this.rearm();
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
    /* v8 ignore next -- currentSeat always indexes a real seat */
    const since = this.players[seat]?.disconnectedAt ?? null;
    if (since === null) return false;
    return this.deps.clock.now() - since >= this.reconnectGraceMs;
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
      // The main clock is gone. Bring the turn to the point where only a discard
      // is left — drawing, and settling any pile obligation, are not choices the
      // player still gets to make — then open the discard-only window so they
      // still pick their own card instead of having one picked for them.
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
    // send none rather than one that silently slides.
    const deadlineAt = this.paused || !this.started ? null : this.deadline();
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
