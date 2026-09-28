import type { Action, ActionSource, LoggedAction } from "@hf/shared";
import type { RoomStore } from "./store";

/**
 * The append-only record of everything that happened in a room.
 *
 * It is behind an interface because the storage changes and the callers should
 * not: the room reads it from memory either way, and `StoredActionLog` also hands
 * each row to a `RoomStore`, which is what lets a restart replay it. What the log is *for* is broader than durability —
 * reproducing a defect from a real game, turning that game into a regression
 * test, and collecting a corpus for the agent all read the same rows.
 */
export interface ActionLog {
  /** Record an accepted action. Rejected actions are not events and are not logged. */
  append(seat: number, action: Action, source: ActionSource, at: number): LoggedAction;
  /** Everything so far, oldest first. */
  entries(): readonly LoggedAction[];
  readonly length: number;
}

export class InMemoryActionLog implements ActionLog {
  private readonly rows: LoggedAction[];

  /** Seeded with the rows a restored room already had, so numbering carries on. */
  constructor(rows: readonly LoggedAction[] = []) {
    this.rows = [...rows];
  }

  append(seat: number, action: Action, source: ActionSource, at: number): LoggedAction {
    const row: LoggedAction = { seq: this.rows.length, seat, action, source, at };
    this.rows.push(row);
    return row;
  }

  entries(): readonly LoggedAction[] {
    return this.rows;
  }

  get length(): number {
    return this.rows.length;
  }
}

/**
 * A log that also writes each row through to a store.
 *
 * Reads stay in memory: the store is written behind the game, never consulted
 * during it, so the room never waits on the database to know its own history.
 */
export class StoredActionLog implements ActionLog {
  constructor(
    private readonly inner: ActionLog,
    private readonly store: RoomStore,
    private readonly uid: string,
  ) {}

  append(seat: number, action: Action, source: ActionSource, at: number): LoggedAction {
    const row = this.inner.append(seat, action, source, at);
    this.store.appendAction(this.uid, row);
    return row;
  }

  entries(): readonly LoggedAction[] {
    return this.inner.entries();
  }

  get length(): number {
    return this.inner.length;
  }
}
