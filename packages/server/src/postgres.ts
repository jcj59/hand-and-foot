/**
 * The room store on Postgres.
 *
 * Two tables: `rooms`, one row per table ever opened, and `actions`, its log.
 * Nothing is deleted. A closed room is only marked closed, because a finished
 * game is worth more kept than dropped — it reproduces a defect exactly, it can
 * become a regression test, and it is a training example for the agent.
 *
 * Writes go through `WriteBehind`: issued in order, never awaited by the game,
 * retried through a short outage, and given up on — loudly — after that. Giving
 * up leaves a gap, and a gap is caught on the way back in: `Room.restore` refuses
 * a log that does not run contiguously, so a lost write costs that one room its
 * restart, never a game rebuilt wrong.
 */
import postgres from "postgres";
import type { Action, ActionSource, LoggedAction, RulesConfig } from "@hf/shared";
import type { RoomRecord, RoomStore, SeatRecord, StoredRoom } from "./store";

/** Just enough of `console` to report through; see `main.ts`. */
export interface StoreLogger {
  error(message: string): void;
}

/**
 * Schema changes, applied in order and each exactly once.
 *
 * Append only: a statement that has run anywhere must never be edited, because
 * the database that ran it will not run it again. Change the schema by adding
 * the next entry.
 *
 * Times are epoch milliseconds in `bigint`, the same number the server's `Clock`
 * reads, so nothing is converted on the way in or out. The room's primary key is
 * `uid`, not its code: codes are short enough to come round again, and a new table
 * must never inherit an old one's log. The code is unique only among open rooms.
 */
export const MIGRATIONS: readonly string[] = [
  `create table rooms (
     uid text primary key,
     code text not null,
     config jsonb not null,
     seed bigint not null,
     created_at bigint not null,
     players jsonb not null,
     started boolean not null,
     paused_seat integer,
     closed_at bigint
   );
   create unique index rooms_open_code on rooms (code) where closed_at is null;
   create table actions (
     room_uid text not null references rooms (uid),
     seq integer not null,
     seat integer not null,
     action jsonb not null,
     source text not null,
     at bigint not null,
     primary key (room_uid, seq)
   );`,
  // Hosting can be handed on, so who hosts is no longer implied by seat 0.
  `alter table rooms add column host_token text;`,
  // Between rounds and after the match: who is ready, who went on, and where to.
  `alter table rooms add column waiting jsonb;`,
];

/**
 * Arbitrary, but fixed: it names the one lock every server takes to migrate, so
 * two processes booting at once cannot both apply the same step.
 */
const MIGRATION_LOCK = 7_346_127;

/** Bring the schema up to date. Safe to run on every boot, and concurrently. */
export async function migrate(sql: postgres.Sql): Promise<number> {
  let applied = 0;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx`create table if not exists schema_migrations (
      version integer primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set((await tx`select version from schema_migrations`).map((r) => r.version));
    for (const [index, statement] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (done.has(version)) continue;
      await tx.unsafe(statement);
      await tx`insert into schema_migrations (version) values (${version})`;
      applied++;
    }
  });
  return applied;
}

/** Back-off between attempts at one write; its length is the number of retries. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [100, 500, 2_000, 5_000];

/**
 * How long a shutdown waits for queued writes before giving up on them. It has to
 * fall well inside a host's kill timeout (30s is a common default, Fly's among
 * them), leaving room to end the connection pool: a process killed mid-flush
 * loses the same writes, and says nothing about which.
 */
export const DEFAULT_SHUTDOWN_DEADLINE_MS = 20_000;

/**
 * Run writes one at a time, in the order they were issued.
 *
 * Order is the point. A room's record must land before its first action, whose
 * foreign key needs it, and a room's actions before anything that reads them
 * back; a pool running writes concurrently would promise none of that. At this
 * scale — a handful of moves a minute per table — one at a time is ample.
 */
export class WriteBehind {
  private tail: Promise<void> = Promise.resolve();
  /** Everything enqueued and not yet finished with, oldest first. */
  private readonly pending = new Set<{ readonly label: string }>();
  private closing: Promise<void> | undefined;
  private abandoned = false;
  private interrupt!: () => void;
  private readonly interrupted = new Promise<void>((resolve) => {
    this.interrupt = resolve;
  });

  constructor(
    private readonly logger: StoreLogger,
    private readonly retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  enqueue(label: string, write: () => Promise<unknown>): void {
    const entry = { label };
    this.pending.add(entry);
    this.tail = this.tail.then(async () => {
      if (!this.abandoned) await this.attempt(label, write);
      this.pending.delete(entry);
    });
  }

  /** Resolves once everything enqueued so far has either landed or been given up on. */
  flush(): Promise<void> {
    return this.tail;
  }

  /**
   * Stop taking the queue's time, for a process on its way out.
   *
   * Retrying is for riding out an outage the game will outlive; a process being
   * stopped will not, so a write that fails from here on is given up on at once,
   * and one waiting out a back-off stops waiting. The queue then gets until the
   * deadline to drain. Whatever is still left is abandoned — never started, and
   * not reported one by one — under a single line naming each write, so the
   * rooms a restart will find behind or refuse are on record.
   *
   * Safe to call twice; the second call waits on the first.
   */
  close(deadlineMs: number): Promise<void> {
    this.closing ??= this.drain(deadlineMs);
    return this.closing;
  }

  private async drain(deadlineMs: number): Promise<void> {
    this.interrupt();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<true>((resolve) => {
      timer = setTimeout(() => resolve(true), deadlineMs);
    });
    const timedOut = await Promise.race([this.tail.then(() => false), expired]);
    clearTimeout(timer);
    if (!timedOut) return;
    this.abandoned = true;
    const labels = [...this.pending].map((entry) => entry.label);
    this.logger.error(
      `store: shut down after ${deadlineMs}ms with ${labels.length} writes abandoned: ${labels.join(", ")}`,
    );
  }

  private async attempt(label: string, write: () => Promise<unknown>): Promise<void> {
    for (let retry = 0; ; retry++) {
      try {
        await write();
        return;
      } catch (error) {
        if (this.abandoned) return;
        const delay = this.retryDelaysMs[retry];
        if (delay !== undefined && !this.closing) {
          await Promise.race([this.sleep(delay), this.interrupted]);
          if (!this.closing) continue;
        }
        // Never rethrown: the game has long since moved on, and nothing is left
        // waiting on this write to tell. Saying so is all that can be done.
        this.logger.error(`store: gave up on ${label}: ${messageOf(error)}`);
        return;
      }
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PostgresStoreOptions {
  readonly logger?: StoreLogger;
  readonly retryDelaysMs?: readonly number[];
  readonly shutdownDeadlineMs?: number;
}

export class PostgresRoomStore implements RoomStore {
  private readonly writes: WriteBehind;
  private readonly shutdownDeadlineMs: number;

  constructor(
    private readonly sql: postgres.Sql,
    options: PostgresStoreOptions = {},
  ) {
    this.writes = new WriteBehind(options.logger ?? console, options.retryDelaysMs);
    this.shutdownDeadlineMs = options.shutdownDeadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS;
  }

  saveRoom(room: RoomRecord): void {
    const { sql } = this;
    this.writes.enqueue(`room ${room.id}`, () => {
      const players = sql.json(room.players as unknown as postgres.JSONValue);
      // Whichever of these the record has; an absent one stays absent on load.
      const { nextRoundReady, wentOn, nextRoomId, idlePaused, pausedSince, savedUntil } = room;
      const waiting = sql.json({
        nextRoundReady,
        wentOn,
        nextRoomId,
        idlePaused,
        pausedSince,
        savedUntil,
      } as postgres.JSONValue);
      return sql`
        insert into rooms (uid, code, config, seed, created_at, players, started, paused_seat, host_token, waiting)
        values (${room.uid}, ${room.id}, ${sql.json(room.config as unknown as postgres.JSONValue)},
                ${room.seed}, ${room.createdAt}, ${players}, ${room.started}, ${room.pausedSeat},
                ${room.hostToken ?? null}, ${waiting})
        on conflict (uid) do update set
          players = excluded.players,
          started = excluded.started,
          paused_seat = excluded.paused_seat,
          host_token = excluded.host_token,
          waiting = excluded.waiting`;
    });
  }

  appendAction(uid: string, entry: LoggedAction): void {
    const { sql } = this;
    this.writes.enqueue(`action ${entry.seq} of ${uid}`, () => {
      const action = sql.json(entry.action as unknown as postgres.JSONValue);
      // A retry after a write that did land but lost its reply must not fail on
      // the key: the row is already exactly what it would have written.
      return sql`
        insert into actions (room_uid, seq, seat, action, source, at)
        values (${uid}, ${entry.seq}, ${entry.seat}, ${action}, ${entry.source}, ${entry.at})
        on conflict do nothing`;
    });
  }

  closeRoom(uid: string, at: number): void {
    const { sql } = this;
    this.writes.enqueue(`closing ${uid}`, () => {
      return sql`update rooms set closed_at = ${at} where uid = ${uid} and closed_at is null`;
    });
  }

  async loadOpen(): Promise<readonly StoredRoom[]> {
    const { sql } = this;
    const rooms = await sql`
      select uid, code, config, seed, created_at, players, started, paused_seat, host_token, waiting
      from rooms where closed_at is null order by created_at`;
    if (rooms.length === 0) return [];
    const actions = await sql`
      select a.room_uid, a.seq, a.seat, a.action, a.source, a.at
      from actions a join rooms r on r.uid = a.room_uid
      where r.closed_at is null
      order by a.room_uid, a.seq`;

    const logs = new Map<string, LoggedAction[]>();
    for (const row of actions) {
      const log = logs.get(row.room_uid) ?? [];
      log.push({
        seq: row.seq,
        seat: row.seat,
        action: row.action as Action,
        source: row.source as ActionSource,
        // `bigint` arrives as a string, because it can exceed a double; epoch
        // milliseconds will not for a few hundred thousand years.
        at: Number(row.at),
      });
      logs.set(row.room_uid, log);
    }
    return rooms.map((row) => ({
      room: {
        uid: row.uid,
        id: row.code,
        config: row.config as RulesConfig,
        seed: Number(row.seed),
        createdAt: Number(row.created_at),
        players: row.players as SeatRecord[],
        started: row.started,
        pausedSeat: row.paused_seat,
        hostToken: row.host_token,
        // Null on a row written before the column existed: nothing was pending.
        ...((row.waiting ?? {}) as Pick<
          RoomRecord,
          "nextRoundReady" | "wentOn" | "nextRoomId" | "idlePaused" | "pausedSince" | "savedUntil"
        >),
      },
      actions: logs.get(row.uid) ?? [],
    }));
  }

  flush(): Promise<void> {
    return this.writes.flush();
  }

  async close(): Promise<void> {
    await this.writes.close(this.shutdownDeadlineMs);
    await this.sql.end({ timeout: 5 });
  }
}

/**
 * Connect, bring the schema up to date, and hand back a store.
 *
 * A handful of connections is plenty: writes go one at a time, and reads happen
 * once, at boot.
 */
export async function openPostgresStore(
  url: string,
  options: PostgresStoreOptions = {},
): Promise<PostgresRoomStore> {
  const sql = postgres(url, {
    max: 4,
    connect_timeout: 10,
    idle_timeout: 60,
    // Postgres reports "relation already exists, skipping" and the like as
    // notices; they are expected on every boot and are not worth a log line.
    onnotice: () => {},
  });
  try {
    await migrate(sql);
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }
  return new PostgresRoomStore(sql, options);
}
