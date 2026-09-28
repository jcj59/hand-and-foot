/**
 * The write queue, on its own. The Postgres store itself is exercised against a
 * real database by the contract in `store.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY_DELAYS_MS, MIGRATIONS, WriteBehind } from "./postgres";

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

describe("MIGRATIONS", () => {
  it("keys rooms by uid and keeps a code unique only among open rooms", () => {
    // The schema's two load-bearing choices; see the comment on MIGRATIONS.
    expect(MIGRATIONS[0]).toMatch(/uid text primary key/);
    expect(MIGRATIONS[0]).toMatch(
      /unique index rooms_open_code on rooms \(code\) where closed_at is null/,
    );
  });
});
