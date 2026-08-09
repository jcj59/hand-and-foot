import type { Action, ActionSource, LoggedAction } from "@hf/shared";

/**
 * The append-only record of everything that happened in a room.
 *
 * It is behind an interface because the storage changes and the callers should
 * not: M2 keeps it in memory, M4 writes it to Postgres and replays it to rebuild
 * live games after a restart. What the log is *for* is broader than durability —
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
  private readonly rows: LoggedAction[] = [];

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
