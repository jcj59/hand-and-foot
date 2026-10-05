/**
 * What survives a restart.
 *
 * A single process holds every room in memory, which is enough for the scale this
 * is built for but means a restart — and every deploy is one — would otherwise
 * drop every game in progress. The engine is a deterministic reducer, so a game
 * does not need its state graph saved: its seed and its action log reproduce it
 * exactly. What the log cannot carry is everything that happens around the game
 * rather than in it — who is sitting where, whether the table has dealt, whether
 * it is paused — so each room also keeps a small record of that.
 *
 * The store is a durability backstop, never a coordinator. Writes are issued after
 * the game has already moved on, and nothing on the hot path waits for one: a
 * slow or unreachable database costs recoverability, not a player's turn.
 */
import type { Avatar, LoggedAction, RulesConfig } from "@hf/shared";
import type { UserStore } from "./users";
import type { LoginStore } from "./accounts";
import { InMemoryMatchStore, type MatchStore } from "./matches";

/** One seat, as much of it as outlives a process. Connection state does not. */
export interface SeatRecord {
  readonly seat: number;
  readonly name: string;
  readonly token: string;
  readonly left: boolean;
  /** Who sat here, when their browser proved an identity. Absent from older records. */
  readonly userId?: string;
  /** The picture they chose. Absent from older records, and for anyone who chose none. */
  readonly avatar?: Avatar;
  /** A computer player the host added. Absent for people, and from older records. */
  readonly bot?: true;
}

/** A room, minus its game — which the log reconstructs. */
export interface RoomRecord {
  /**
   * The room's identity in storage. Not its code: codes are short enough to be
   * reused once a room closes, and a new table must never inherit an old one's log.
   */
  readonly uid: string;
  /** The code players type. Unique among open rooms only. */
  readonly id: string;
  readonly config: RulesConfig;
  readonly seed: number;
  readonly createdAt: number;
  readonly players: readonly SeatRecord[];
  readonly started: boolean;
  /**
   * The seat that took the first turn of the match, once dealt. Absent from
   * records saved before it was chosen at random, whose matches all started at
   * seat 0 — and their logs replay only from there.
   */
  readonly firstSeat?: number;
  readonly pausedSeat: number | null;
  /** Token of the player who hosts. Absent from records saved before it could change. */
  readonly hostToken?: string | null;
  /** Tokens of the players ready for the next round. Absent from older records. */
  readonly nextRoundReady?: readonly string[];
  /** Tokens of the players who went on to the next game. Absent from older records. */
  readonly wentOn?: readonly string[];
  /** The next game's table. Absent from older records. */
  readonly nextRoomId?: string | null;
  /** The table paused itself for want of anyone playing. Absent from older records. */
  readonly idlePaused?: boolean;
  /** When the current pause began, so a restart does not restart its time limit. */
  readonly pausedSince?: number | null;
  /** When a table saved for later stops being kept. */
  readonly savedUntil?: number | null;
}

/** A room as loaded back: its record, and its log oldest first. */
export interface StoredRoom {
  readonly room: RoomRecord;
  readonly actions: readonly LoggedAction[];
}

export interface RoomStore {
  /**
   * Where identities are kept, for a store that can keep them too — the database
   * does. Without one the server keeps them in memory.
   */
  users?(): UserStore;
  /** Where usernames are kept, beside the identities they lead to. */
  logins?(): LoginStore;
  /** Where finished matches are kept, for a store that can keep them too. In memory otherwise. */
  matches?(): MatchStore;
  /** Record the room's current seating and status, replacing what was there. */
  saveRoom(room: RoomRecord): void;
  /** Record one accepted action. */
  appendAction(uid: string, entry: LoggedAction): void;
  /**
   * Mark a room finished with, so it is not brought back. Its rows are kept: a
   * finished game is a regression test and a training example, not garbage.
   */
  closeRoom(uid: string, at: number): void;
  /** Every room not yet closed, as of the last completed write. */
  loadOpen(): Promise<readonly StoredRoom[]>;
  /** Resolves once every write issued so far has settled. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * A store that lives only as long as the object does.
 *
 * Two servers sharing one of these is exactly a restart with a database behind it,
 * minus the database, which is how most of the restart behaviour is tested. Records
 * go through JSON on the way in, as they do into a `jsonb` column, so a test cannot
 * pass by reading back the very object the room still holds, nor by keeping
 * something — `undefined`, a class instance — that the database would not.
 */
function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryRoomStore implements RoomStore {
  private readonly kept = new InMemoryMatchStore();
  private readonly rooms = new Map<string, { room: RoomRecord; closedAt: number | null }>();
  private readonly logs = new Map<string, LoggedAction[]>();

  matches(): MatchStore {
    return this.kept;
  }

  saveRoom(room: RoomRecord): void {
    const closedAt = this.rooms.get(room.uid)?.closedAt ?? null;
    this.rooms.set(room.uid, { room: viaJson(room), closedAt });
  }

  appendAction(uid: string, entry: LoggedAction): void {
    const log = this.logs.get(uid) ?? [];
    // Idempotent on `seq`, like the database's primary key, so a retried write
    // cannot record the same move twice.
    if (!log.some((row) => row.seq === entry.seq)) log.push(viaJson(entry));
    this.logs.set(uid, log);
  }

  closeRoom(uid: string, at: number): void {
    const stored = this.rooms.get(uid);
    if (stored) stored.closedAt = at;
  }

  async loadOpen(): Promise<readonly StoredRoom[]> {
    const open: StoredRoom[] = [];
    for (const [uid, { room, closedAt }] of this.rooms) {
      if (closedAt !== null) continue;
      const actions = [...(this.logs.get(uid) ?? [])].sort((a, b) => a.seq - b.seq);
      open.push(viaJson({ room, actions }));
    }
    return open;
  }

  /** Whether a room was closed, for tests. Undefined when it was never saved. */
  closedAt(uid: string): number | null | undefined {
    return this.rooms.get(uid)?.closedAt;
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}
