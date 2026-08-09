import {
  type Action,
  type ActionSource,
  type ClockState,
  type GameState,
  type RoomInfo,
  type RoundEnded,
  type RulesConfig,
  type ViewUpdate,
} from "@hf/shared";
import { applyAction, deal, project, scoreRound } from "@hf/engine";
import type { Clock } from "./clock";
import { type ActionLog, InMemoryActionLog } from "./log";

/** The engine will deal any number of seats; a game of Hand and Foot will not. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

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
}

/**
 * One table: its seats, its authoritative game state, and its action log.
 *
 * The room never trusts a submitted state, only a submitted *action*, which it
 * validates through the engine before anything changes. Everything a client sees
 * of the game comes from `project()`, so a bug here cannot leak a hidden card —
 * the worst it can do is show a player too little.
 *
 * Transport lives in `socket.ts`; this class has no idea sockets exist, which is
 * what lets the whole game be driven directly in tests and, later, headlessly by
 * the agent.
 */
export class Room {
  readonly id: string;
  readonly config: RulesConfig;
  readonly log: ActionLog;

  private readonly deps: RoomDeps;
  private readonly players: RoomPlayer[] = [];
  private state: GameState | null = null;
  private pausedSeat: number | undefined;

  constructor(id: string, config: RulesConfig, deps: RoomDeps) {
    this.id = id;
    this.config = config;
    this.deps = deps;
    this.log = deps.log ?? new InMemoryActionLog();
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

  /** The authoritative state, or null before the game starts. Read-only to callers. */
  get gameState(): GameState | null {
    return this.state;
  }

  seats(): readonly RoomPlayer[] {
    return this.players;
  }

  seatOf(token: string): RoomPlayer | undefined {
    return this.players.find((p) => p.token === token);
  }

  join(name: string): RoomResult<RoomPlayer> {
    if (this.started) return fail("the game has already started");
    if (this.players.length >= MAX_PLAYERS) return fail(`a table seats at most ${MAX_PLAYERS}`);
    const player: RoomPlayer = {
      seat: this.players.length,
      name,
      token: this.deps.newToken(),
      connected: true,
    };
    this.players.push(player);
    return succeed(player);
  }

  /** Reclaim a seat after dropping off. Idempotent: rejoining twice is not an error. */
  resume(token: string): RoomResult<RoomPlayer> {
    const player = this.seatOf(token);
    if (!player) return fail("that seat token does not belong to this room");
    player.connected = true;
    return succeed(player);
  }

  setConnected(seat: number, connected: boolean): void {
    const player = this.players[seat];
    if (player) player.connected = connected;
  }

  start(seat: number): RoomResult<GameState> {
    if (this.started) return fail("the game has already started");
    if (seat !== this.hostSeat) return fail("only the host can start the game");
    if (this.players.length < MIN_PLAYERS) {
      return fail(`a game needs at least ${MIN_PLAYERS} players`);
    }
    this.state = deal(this.players.length, this.config, this.deps.seed);
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
    this.pausedSeat = paused ? seat : undefined;
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

    const result = applyAction(state, action);
    if (!result.ok) return fail(result.error);

    this.state = result.state;
    this.log.append(seat, action, source, this.deps.clock.now());
    return succeed(undefined);
  }

  /**
   * The clock as the client should render it. No turn clock runs yet — pacing
   * lands in M2c — so there is no deadline to report, only the pause flag, which
   * is already meaningful.
   */
  clockState(): ClockState {
    return {
      serverNow: this.deps.clock.now(),
      deadlineAt: null,
      inDiscardGrace: false,
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
    return { view: project(this.state, seat), clock: this.clockState(), room: this.info() };
  }

  /** Final scores, once the round is over. */
  result(): RoundEnded | null {
    if (!this.state?.roundEnded) return null;
    return { scores: scoreRound(this.state), wentOutSeat: this.state.wentOutSeat };
  }
}
