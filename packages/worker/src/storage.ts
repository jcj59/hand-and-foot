/**
 * A table's storage, in its Durable Object.
 *
 * The same `RoomStore` the Node server keeps in Postgres, over the object's own
 * SQLite-backed key-value storage instead: each table is its own object, so it
 * keeps its own record and log and nothing else. Writes are synchronous and are
 * made durable before any reply leaves the object, so the log is never behind the
 * game a player was told about.
 *
 * Each game at a code keeps its own record and log, under its `uid`; `current`
 * names the one being played. A finished game is closed rather than deleted,
 * which keeps it as a record of how it was played.
 */
import type { LoggedAction } from "@hf/shared";
import type { RoomRecord, RoomStore, StoredRoom } from "@hf/server/core";

const CURRENT = "current";
const roomKey = (uid: string): string => `room:${uid}`;
const logPrefix = (uid: string): string => `log:${uid}:`;
// Zero-padded so the keys list in the order the moves were made.
const logKey = (uid: string, seq: number): string =>
  `${logPrefix(uid)}${String(seq).padStart(9, "0")}`;

export class DurableRoomStore implements RoomStore {
  constructor(private readonly kv: SyncKvStorage) {}

  saveRoom(room: RoomRecord): void {
    // A closed game's record is not reopened by a late save.
    if (this.kv.get(`closed:${room.uid}`) !== undefined) return;
    this.kv.put(roomKey(room.uid), room);
    this.kv.put(CURRENT, room.uid);
  }

  appendAction(uid: string, entry: LoggedAction): void {
    this.kv.put(logKey(uid, entry.seq), entry);
  }

  closeRoom(uid: string, at: number): void {
    this.kv.put(`closed:${uid}`, at);
    if (this.kv.get(CURRENT) === uid) this.kv.delete(CURRENT);
  }

  /** The game being played here, if there is one. */
  current(): StoredRoom | null {
    const uid = this.kv.get<string>(CURRENT);
    if (uid === undefined) return null;
    const room = this.kv.get<RoomRecord>(roomKey(uid));
    /* v8 ignore next -- current is only ever set alongside the record it names */
    if (!room) return null;
    const actions = [...this.kv.list<LoggedAction>({ prefix: logPrefix(uid) })].map(([, a]) => a);
    return { room, actions };
  }

  async loadOpen(): Promise<readonly StoredRoom[]> {
    const current = this.current();
    return current ? [current] : [];
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}
