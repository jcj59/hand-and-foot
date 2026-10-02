import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type CloseReason,
  type RulesConfig,
} from "@hf/shared";
import { defaultConfig } from "@hf/engine";
import { type Clock, systemClock } from "./clock";
import { Room, type RoomResult, type SeatProfile } from "./room";
import type { RoomStore, StoredRoom } from "./store";

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
  /** Where rooms are kept so a restart can bring them back. None keeps them in memory only. */
  readonly store?: RoomStore;
  /** Storage identity for a new room; see `RoomRecord.uid`. Injected for deterministic tests. */
  readonly newUid?: () => string;
}

/** A stored room that could not be brought back, and why. */
export interface RestoreFailure {
  readonly uid: string;
  readonly id: string;
  readonly error: string;
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
  private readonly store: RoomStore | undefined;
  private readonly newUid: () => string;
  private cancelSweep: (() => void) | null = null;

  /** Told when a room is removed, so whatever else holds it can let go too. */
  onRemove: ((room: Room, reason?: CloseReason) => void) | null = null;

  constructor(options: ManagerOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.reconnectGraceMs = options.reconnectGraceMs;
    this.abandonedRoomMs = options.abandonedRoomMs ?? DEFAULT_ABANDONED_ROOM_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.store = options.store;
    // The global rather than node:crypto: this module also runs in a Cloudflare Worker.
    this.newUid = options.newUid ?? (() => crypto.randomUUID());
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
      store: this.store,
      uid: this.newUid(),
    });
    this.rooms.set(id, room);
    // Recorded as soon as it exists, so the log's first row always has a room to
    // belong to, even for a table that is dealt before anyone else joins.
    this.store?.saveRoom(room.record());
    return room;
  }

  /**
   * Bring back the rooms a previous process left open.
   *
   * A room that will not replay is closed rather than retried on every boot, and
   * reported so the operator hears about it. Its rows stay in the store, which is
   * what makes such a failure debuggable: the seed and the log are exactly the
   * reproduction.
   */
  restore(stored: readonly StoredRoom[]): readonly RestoreFailure[] {
    const failures: RestoreFailure[] = [];
    for (const entry of stored) {
      const { uid, id } = entry.room;
      const restored = this.rooms.has(id.toUpperCase())
        ? { ok: false as const, error: `room ${id}: that code is already in use` }
        : Room.restore(entry, {
            clock: this.clock,
            newToken: () => randomString(ROOM_CODE_ALPHABET, 24, this.random),
            reconnectGraceMs: this.reconnectGraceMs,
            store: this.store,
          });
      if (!restored.ok) {
        failures.push({ uid, id, error: restored.error });
        this.store?.closeRoom(uid, this.clock.now());
        continue;
      }
      this.rooms.set(id.toUpperCase(), restored.value);
    }
    return failures;
  }

  /** Room codes are matched case-insensitively; nobody types a link exactly. */
  join(
    roomId: string,
    name: string,
    profile: SeatProfile = {},
  ): RoomResult<{ room: Room; seat: number; token: string }> {
    const room = this.get(roomId);
    if (!room) return { ok: false, error: "no room with that code" };
    const joined = room.join(name, profile);
    if (!joined.ok) return joined;
    return { ok: true, value: { room, seat: joined.value.seat, token: joined.value.token } };
  }

  /** Close a room; `reason` says why, when it was closed for being left idle. */
  remove(roomId: string, reason?: CloseReason): boolean {
    const room = this.get(roomId);
    // Dropping the reference is not enough: a room holds a live timer, and one
    // left armed would keep firing against a table nobody can see.
    room?.dispose();
    // Closed in the store too, or the next boot would bring back a room that was
    // deliberately let go.
    if (room) this.store?.closeRoom(room.uid, this.clock.now());
    if (room) this.onRemove?.(room, reason);
    return this.rooms.delete(roomId.toUpperCase());
  }

  /**
   * Close rooms nobody is playing any more: everyone gone, or paused past the
   * pause's limit — see `Room.closing`.
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
      const closing = room.closing(this.abandonedRoomMs);
      if (closing === null || now < closing.at) continue;
      // One teardown path, so a room can never be dropped without releasing its
      // timer. (In practice an abandoned room has already gone quiet, but that
      // is a property of `Room`, not something the manager should rely on.)
      this.remove(id, closing.reason);
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

  /**
   * Release every room's timer. Used when the process is shutting down.
   *
   * Unlike `remove`, this leaves the rooms open in the store: a shutdown is the
   * restart persistence exists to survive, not the end of the games.
   */
  disposeAll(): void {
    this.stopSweeping();
    for (const room of this.rooms.values()) room.dispose();
  }

  private newCode(): string {
    return randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, this.random);
  }
}
