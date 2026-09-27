import {
  EAST_COAST,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  WEST_COAST,
  type RoomOptions,
  type RulesConfig,
} from "@hf/shared";
import { defaultConfig } from "@hf/engine";
import { type Clock, systemClock } from "./clock";
import { Room, type RoomResult } from "./room";

/**
 * Turn the creator's choices into the rules the table will actually play by.
 *
 * The option set is deliberately small and closed so that a value outside it
 * can be coerced to a safe default without a validator — TypeScript only
 * enforces the `RoomOptions` union for typed callers, and `options` here
 * arrives from an untyped socket payload, so every field is normalized
 * rather than trusted as-is. `mode` decides pausing rather than leaving it as
 * a second switch, because a competitive table is precisely one where the
 * clock cannot be stopped, and letting the two be set independently would
 * only create states nobody wants.
 */
export function configFor(options: RoomOptions = {}): RulesConfig {
  const preset = options.preset === "west-coast" ? WEST_COAST : EAST_COAST;
  if (options.mode === undefined) return preset;
  const mode = options.mode === "competitive" ? "competitive" : "family";
  return { ...preset, mode, pauseEnabled: mode === "family" };
}

// The alphabet and length live in `@hf/shared`, because the client validates a
// typed code against them before spending a round trip. Six characters from a
// 31-symbol alphabet is ~2.9 billion codes, ample for short-lived rooms.

export const DEFAULT_ABANDONED_ROOM_MS = 10 * 60_000;
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export interface ManagerOptions {
  readonly clock?: Clock;
  /**
   * Injected rather than reached for so tests are deterministic. In production
   * these are random; the game seed in particular must stay on the server, since
   * it determines the deck order.
   */
  readonly random?: () => number;
  /** Grace a dropped player gets before the server plays their turns. */
  readonly reconnectGraceMs?: number;
  /** How long a room with nobody in it is kept before being reaped. */
  readonly abandonedRoomMs?: number;
  readonly sweepIntervalMs?: number;
}

function randomString(alphabet: string, length: number, random: () => number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return out;
}

/** Owns the set of live rooms and hands out room codes and seat tokens. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly reconnectGraceMs: number | undefined;
  private readonly abandonedRoomMs: number;
  private readonly sweepIntervalMs: number;
  private cancelSweep: (() => void) | null = null;

  constructor(options: ManagerOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.reconnectGraceMs = options.reconnectGraceMs;
    this.abandonedRoomMs = options.abandonedRoomMs ?? DEFAULT_ABANDONED_ROOM_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  get size(): number {
    return this.rooms.size;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId.toUpperCase());
  }

  create(config: RulesConfig = defaultConfig): Room {
    let id = this.newCode();
    // Collisions are vanishingly unlikely but not impossible, and reusing a live
    // room's code would drop a stranger into someone else's game.
    while (this.rooms.has(id)) id = this.newCode();

    const room = new Room(id, config, {
      clock: this.clock,
      seed: Math.floor(this.random() * 2 ** 31),
      newToken: () => randomString(ROOM_CODE_ALPHABET, 24, this.random),
      reconnectGraceMs: this.reconnectGraceMs,
    });
    this.rooms.set(id, room);
    return room;
  }

  /** Room codes are matched case-insensitively; nobody types a link exactly. */
  join(roomId: string, name: string): RoomResult<{ room: Room; seat: number; token: string }> {
    const room = this.get(roomId);
    if (!room) return { ok: false, error: "no room with that code" };
    const joined = room.join(name);
    if (!joined.ok) return joined;
    return { ok: true, value: { room, seat: joined.value.seat, token: joined.value.token } };
  }

  remove(roomId: string): boolean {
    const room = this.get(roomId);
    // Dropping the reference is not enough: a room holds a live timer, and one
    // left armed would keep firing against a table nobody can see.
    room?.dispose();
    return this.rooms.delete(roomId.toUpperCase());
  }

  /**
   * Drop rooms nobody is in any more.
   *
   * This is not just tidiness. A table where every seat has dropped never ends
   * its round on its own — the default policy settles obligations and discards
   * but never melds, so nobody gets down, nobody goes out, and the stock keeps
   * reshuffling out of the discard pile. Left alone, such a room plays forever.
   */
  sweep(): readonly string[] {
    const now = this.clock.now();
    const reaped: string[] = [];
    for (const [id, room] of this.rooms) {
      const since = room.abandonedSince;
      if (since === null || now - since < this.abandonedRoomMs) continue;
      // One teardown path, so a room can never be dropped without releasing its
      // timer. (In practice an abandoned room has already gone quiet, but that
      // is a property of `Room`, not something the manager should rely on.)
      this.remove(id);
      reaped.push(id);
    }
    return reaped;
  }

  startSweeping(): void {
    if (this.cancelSweep) return;
    const tick = (): void => {
      this.sweep();
      this.cancelSweep = this.clock.setTimer(this.sweepIntervalMs, tick);
    };
    this.cancelSweep = this.clock.setTimer(this.sweepIntervalMs, tick);
  }

  stopSweeping(): void {
    this.cancelSweep?.();
    this.cancelSweep = null;
  }

  /** Release every room's timer. Used when the process is shutting down. */
  disposeAll(): void {
    this.stopSweeping();
    for (const room of this.rooms.values()) room.dispose();
  }

  private newCode(): string {
    return randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, this.random);
  }
}
