import { describe, expect, it } from "vitest";
import { MAX_COUNTED, RateLimiter, READ_LIMIT, READ_WINDOW_MS } from "../src/limits";

const T = 1_800_000_000_000;

describe("the read limit", () => {
  it("is 30 reads a minute per identity, counting at most 10,000 identities", () => {
    expect([READ_LIMIT, READ_WINDOW_MS, MAX_COUNTED]).toEqual([30, 60_000, 10_000]);
  });

  it("allows `limit` takes in a window, then says how many seconds are left in it", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect([0, 1, 2].map((i) => limiter.take("ana", T + i))).toEqual([null, null, null]);
    expect(limiter.take("ana", T + 10_000)).toBe(50);
    expect(limiter.take("ana", T + 10_001)).toBe(50);
    expect(limiter.take("ana", T + 59_999)).toBe(1);
  });

  it("starts a fresh window once the last one has ended, and not before", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.take("ana", T)).toBeNull();
    expect(limiter.take("ana", T + 59_999)).toBe(1);
    expect(limiter.take("ana", T + 60_000)).toBeNull();
    expect(limiter.take("ana", T + 60_001)).toBe(60);
  });

  it("starts afresh for a clock that went backwards rather than waiting it out", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.take("ana", T)).toBeNull();
    expect(limiter.take("ana", T - 1_000)).toBeNull();
  });

  it("counts each key apart", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.take("ana", T)).toBeNull();
    expect(limiter.take("ben", T)).toBeNull();
    expect(limiter.take("ana", T)).toBe(60);
  });

  it("counts at most `maxKeys` keys: ended windows go first, then the oldest", () => {
    const limiter = new RateLimiter(1, 60_000, 3);
    limiter.take("a", T);
    limiter.take("b", T + 30_000);
    limiter.take("c", T + 40_000);
    expect(limiter.size).toBe(3);
    // At T + 60s only a's window has ended; it makes room for d.
    limiter.take("d", T + 60_000);
    expect(limiter.size).toBe(3);
    expect(limiter.take("b", T + 60_000)).toBe(30);
    // None ended now: the oldest, b, goes for e, and starts afresh if it comes back.
    limiter.take("e", T + 61_000);
    expect(limiter.size).toBe(3);
    expect(limiter.take("c", T + 61_000)).toBe(39);
    expect(limiter.take("b", T + 61_000)).toBeNull();
  });

  it("does not make room for a key it is already counting", () => {
    const limiter = new RateLimiter(5, 60_000, 2);
    limiter.take("a", T);
    limiter.take("b", T);
    limiter.take("a", T + 1);
    expect(limiter.take("b", T + 2)).toBeNull();
    expect(limiter.size).toBe(2);
  });

  it("renews a key's ended window in place, without pushing another out", () => {
    const limiter = new RateLimiter(1, 60_000, 2);
    limiter.take("a", T);
    limiter.take("b", T + 30_000);
    expect(limiter.take("a", T + 60_000)).toBeNull();
    expect(limiter.take("b", T + 60_000)).toBe(30);
  });

  it("drops every window that has ended to make room, not only the one it must", () => {
    const limiter = new RateLimiter(1, 60_000, 3);
    limiter.take("a", T);
    limiter.take("b", T);
    limiter.take("c", T + 10);
    limiter.take("d", T + 60_000);
    expect(limiter.size).toBe(2);
  });

  it("makes no room for a key whose clock went backwards: its own window is replaced", () => {
    const limiter = new RateLimiter(1, 60_000, 2);
    limiter.take("b", T);
    limiter.take("a", T + 1);
    expect(limiter.take("a", T - 1_000)).toBeNull();
    // b is still counted, and still out of takes.
    expect(limiter.take("b", T + 2)).toBe(60);
  });
});
