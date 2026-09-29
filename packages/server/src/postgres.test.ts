/**
 * The write queue, on its own. The Postgres store itself is exercised against a
 * real database by the contract in `store.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_SHUTDOWN_DEADLINE_MS,
  MIGRATIONS,
  PostgresRoomStore,
  WriteBehind,
} from "./postgres";

function recorder(): { error(message: string): void; readonly errors: string[] } {
  const errors: string[] = [];
  return { errors, error: (message) => errors.push(message) };
}

/** A sleep that returns at once but remembers how long it was asked for. */
function sleeper(): { sleep(ms: number): Promise<void>; readonly slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms) => {
      slept.push(ms);
    },
  };
}

describe("WriteBehind", () => {
  it("runs writes one at a time, in the order they were issued", async () => {
    const order: string[] = [];
    const queue = new WriteBehind(recorder());
    for (const name of ["room", "action 0", "action 1"]) {
      queue.enqueue(name, async () => {
        order.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 1));
        order.push(`end ${name}`);
      });
    }
    await queue.flush();
    expect(order).toEqual([
      "start room",
      "end room",
      "start action 0",
      "end action 0",
      "start action 1",
      "end action 1",
    ]);
  });

  it("retries through a short outage, backing off as configured", async () => {
    const { sleep, slept } = sleeper();
    const log = recorder();
    const queue = new WriteBehind(log, [10, 20, 30], sleep);
    let attempts = 0;
    queue.enqueue("flaky", async () => {
      if (++attempts < 3) throw new Error("connection reset");
    });
    await queue.flush();
    expect(attempts).toBe(3);
    expect(slept).toEqual([10, 20]);
    expect(log.errors).toEqual([]);
  });

  it("gives up after the last retry, says what and why, and carries on", async () => {
    const { sleep, slept } = sleeper();
    const log = recorder();
    const queue = new WriteBehind(log, [10, 20], sleep);
    let attempts = 0;
    let after = false;
    queue.enqueue("action 3 of uid-1", async () => {
      attempts++;
      throw new Error("database is down");
    });
    queue.enqueue("next", async () => {
      after = true;
    });
    await queue.flush();
    expect(attempts).toBe(3);
    expect(slept).toEqual([10, 20]);
    expect(log.errors).toEqual(["store: gave up on action 3 of uid-1: database is down"]);
    expect(after).toBe(true);
  });

  it("reports something thrown that is not an Error", async () => {
    const log = recorder();
    const queue = new WriteBehind(log, []);
    queue.enqueue("odd", () => Promise.reject("just a string"));
    await queue.flush();
    expect(log.errors).toEqual(["store: gave up on odd: just a string"]);
  });

  it("waits for real between attempts by default", async () => {
    const queue = new WriteBehind(recorder(), [15]);
    let attempts = 0;
    const started = Date.now();
    queue.enqueue("once", async () => {
      if (++attempts === 1) throw new Error("blip");
    });
    await queue.flush();
    expect(attempts).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(14);
  });

  it("rides out a few seconds of outage by default before giving up", () => {
    // Pinned as literals: a change here decides how long a database blip may last
    // before games stop being recoverable, which is an operational decision.
    expect(DEFAULT_RETRY_DELAYS_MS).toEqual([100, 500, 2_000, 5_000]);
  });
});

/** A write that never settles, as one against a database that stopped answering would not. */
function hang(): Promise<void> {
  return new Promise(() => {});
}

describe("WriteBehind on shutdown", () => {
  it("waits for queued writes that land inside the deadline, and says nothing", async () => {
    const log = recorder();
    const queue = new WriteBehind(log);
    const landed: string[] = [];
    for (const name of ["a", "b"]) {
      queue.enqueue(name, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        landed.push(name);
      });
    }
    await queue.close(1_000);
    expect(landed).toEqual(["a", "b"]);
    expect(log.errors).toEqual([]);
  });

  it("returns by the deadline, never starting what is left, and names it all in one line", async () => {
    const log = recorder();
    const queue = new WriteBehind(log);
    let started = 0;
    queue.enqueue("room ABCDEF", () => {
      started++;
      return hang();
    });
    queue.enqueue("action 0 of uid-1", async () => {
      started++;
    });
    const before = Date.now();
    await queue.close(30);
    expect(Date.now() - before).toBeLessThan(1_000);
    expect(started).toBe(1);
    expect(log.errors).toEqual([
      "store: shut down after 30ms with 2 writes abandoned: room ABCDEF, action 0 of uid-1",
    ]);
  });

  it("stays quiet about an abandoned write that fails afterwards, and runs nothing behind it", async () => {
    const log = recorder();
    const queue = new WriteBehind(log);
    let fail: (error: Error) => void = () => {};
    let ranBehind = false;
    queue.enqueue("stuck", () => new Promise((_, reject) => (fail = reject)));
    queue.enqueue("behind", async () => {
      ranBehind = true;
    });
    await queue.close(10);
    // Ending the pool is what rejects the write still in flight.
    fail(new Error("CONNECTION_ENDED"));
    await queue.flush();
    expect(ranBehind).toBe(false);
    expect(log.errors).toEqual([
      "store: shut down after 10ms with 2 writes abandoned: stuck, behind",
    ]);
  });

  it("stops retrying once shutdown starts, giving up on a failing write at once", async () => {
    const { sleep, slept } = sleeper();
    const log = recorder();
    const queue = new WriteBehind(log, [10, 20], sleep);
    let attempts = 0;
    queue.enqueue("action 3 of uid-1", async () => {
      attempts++;
      throw new Error("database is down");
    });
    await queue.close(1_000);
    expect(attempts).toBe(1);
    expect(slept).toEqual([]);
    expect(log.errors).toEqual(["store: gave up on action 3 of uid-1: database is down"]);
  });

  it("cuts short a back-off already under way", async () => {
    const log = recorder();
    const queue = new WriteBehind(log, [60_000], hang);
    let attempts = 0;
    queue.enqueue("flaky", async () => {
      attempts++;
      throw new Error("connection reset");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await queue.close(60_000);
    expect(attempts).toBe(1);
    expect(log.errors).toEqual(["store: gave up on flaky: connection reset"]);
  });

  it("closes once, however many times it is asked", async () => {
    const log = recorder();
    const queue = new WriteBehind(log);
    queue.enqueue("stuck", hang);
    await Promise.all([queue.close(10), queue.close(10)]);
    await queue.close(10);
    expect(log.errors).toHaveLength(1);
  });

  it("leaves room inside a host's usual 30s kill timeout by default", () => {
    // Pinned as a literal: it has to stay under the host's kill timeout, with
    // time to spare for ending the pool, or the host kills the flush mid-write.
    expect(DEFAULT_SHUTDOWN_DEADLINE_MS).toBe(20_000);
  });
});

describe("PostgresRoomStore.close", () => {
  /** Enough of the driver for writes that never answer, and a pool that records being ended. */
  function unanswering(): postgres.Sql & { readonly ended: number } {
    const state = { ended: 0 };
    const sql = Object.assign(() => hang(), {
      json: (value: unknown) => value,
      end: async () => {
        state.ended++;
      },
    });
    Object.defineProperty(sql, "ended", { get: () => state.ended });
    return sql as unknown as postgres.Sql & { readonly ended: number };
  }

  it("abandons writes still queued at the deadline, then ends the pool and returns", async () => {
    const log = recorder();
    const sql = unanswering();
    const store = new PostgresRoomStore(sql, { logger: log, shutdownDeadlineMs: 20 });
    store.closeRoom("uid-1", 5);
    store.closeRoom("uid-2", 6);
    await store.close();
    expect(log.errors).toEqual([
      "store: shut down after 20ms with 2 writes abandoned: closing uid-1, closing uid-2",
    ]);
    expect(sql.ended).toBe(1);
  });
});

describe("MIGRATIONS", () => {
  it("keys rooms by uid and keeps a code unique only among open rooms", () => {
    // The schema's two load-bearing choices; see the comment on MIGRATIONS.
    expect(MIGRATIONS[0]).toMatch(/uid text primary key/);
    expect(MIGRATIONS[0]).toMatch(
      /unique index rooms_open_code on rooms \(code\) where closed_at is null/,
    );
  });
});
