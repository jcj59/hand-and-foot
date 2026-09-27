import { describe, it, expect } from "vitest";
import { createServerClock, RESYNC_THRESHOLD_MS } from "./serverTime";

/** A clock the test moves by hand, mirroring the server's FakeClock. */
function fakeNow(start: number): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe("the resync threshold", () => {
  it("is two seconds", () => {
    // Pinned as a literal rather than against the constant, which every other
    // assertion here references symbolically and so would move with it. The value
    // is a judgement — comfortably above latency jitter, far below any turn timer
    // — so changing it should be a deliberate decision, not a silent edit.
    expect(RESYNC_THRESHOLD_MS).toBe(2_000);
  });
});

describe("anchoring", () => {
  it("starts unanchored and reports no offset", () => {
    const clock = createServerClock(fakeNow(1_000).now);
    expect(clock.anchored).toBe(false);
    expect(clock.offsetMs).toBe(0);
  });

  it("takes the offset from the first server timestamp", () => {
    // The browser is 5s behind the server here.
    const clock = createServerClock(fakeNow(1_000).now);
    clock.anchor(6_000);
    expect(clock.anchored).toBe(true);
    expect(clock.offsetMs).toBe(5_000);
    expect(clock.now()).toBe(6_000);
  });

  it("handles a browser running ahead of the server", () => {
    const clock = createServerClock(fakeNow(10_000).now);
    clock.anchor(9_000);
    expect(clock.offsetMs).toBe(-1_000);
    expect(clock.now()).toBe(9_000);
  });

  it("keeps the first offset through ordinary latency jitter", () => {
    // The whole reason for anchoring once: re-deriving the offset every update
    // would make the rendered countdown stutter by the variation in trip time.
    const time = fakeNow(1_000);
    const clock = createServerClock(time.now);
    clock.anchor(6_000);

    for (const jitter of [40, -30, 80, -55, 12]) {
      time.advance(1_000);
      clock.anchor(clock.now() + 1_000 + jitter);
      expect(clock.offsetMs).toBe(5_000);
    }
  });

  it("re-anchors once the estimate is provably wrong", () => {
    // A slept laptop or a stepped OS clock leaves the offset genuinely wrong,
    // and a turn timer reading minutes out is worse than one that jumps once.
    const time = fakeNow(1_000);
    const clock = createServerClock(time.now);
    clock.anchor(6_000);
    time.advance(1_000);
    clock.anchor(7_000 + RESYNC_THRESHOLD_MS);
    expect(clock.offsetMs).toBe(5_000 + RESYNC_THRESHOLD_MS);
  });

  it("re-anchors when the estimate is wrong in the other direction too", () => {
    const time = fakeNow(1_000);
    const clock = createServerClock(time.now);
    clock.anchor(6_000);
    time.advance(1_000);
    clock.anchor(7_000 - RESYNC_THRESHOLD_MS);
    expect(clock.offsetMs).toBe(5_000 - RESYNC_THRESHOLD_MS);
  });

  it("holds the offset just inside the threshold and rebuilds it exactly at the threshold", () => {
    // Pinned on both sides of the boundary so the comparison cannot quietly
    // become strict or slide by one.
    const inside = fakeNow(1_000);
    const held = createServerClock(inside.now);
    held.anchor(6_000);
    held.anchor(6_000 + RESYNC_THRESHOLD_MS - 1);
    expect(held.offsetMs).toBe(5_000);

    const atEdge = fakeNow(1_000);
    const rebuilt = createServerClock(atEdge.now);
    rebuilt.anchor(6_000);
    rebuilt.anchor(6_000 + RESYNC_THRESHOLD_MS);
    expect(rebuilt.offsetMs).toBe(5_000 + RESYNC_THRESHOLD_MS);
  });

  it("defaults to the real clock when none is injected", () => {
    // The production path: offset against Date.now() should be about zero when
    // anchored to the browser's own time.
    const clock = createServerClock();
    clock.anchor(Date.now());
    expect(Math.abs(clock.offsetMs)).toBeLessThan(1_000);
    expect(clock.anchored).toBe(true);
  });
});

describe("remaining", () => {
  it("is null when there is no deadline", () => {
    // A paused table and a game that has not started both send a null deadline;
    // neither is "zero seconds left".
    const clock = createServerClock(fakeNow(1_000).now);
    clock.anchor(6_000);
    expect(clock.remaining(null)).toBeNull();
  });

  it("measures against the server's clock, not the browser's", () => {
    // The browser reads 1_000 while the server reads 6_000. A deadline of 26_000
    // is 20s away in server time; naively subtracting the browser's own clock
    // would say 25s.
    const clock = createServerClock(fakeNow(1_000).now);
    clock.anchor(6_000);
    expect(clock.remaining(26_000)).toBe(20_000);
  });

  it("counts down as the browser's clock advances", () => {
    const time = fakeNow(1_000);
    const clock = createServerClock(time.now);
    clock.anchor(6_000);
    expect(clock.remaining(26_000)).toBe(20_000);
    time.advance(7_500);
    expect(clock.remaining(26_000)).toBe(12_500);
  });

  it("floors at zero rather than going negative", () => {
    // An expired turn shows no time left; the server decides what happens next,
    // and "overdue by 4s" is not a thing a timer should render.
    const time = fakeNow(1_000);
    const clock = createServerClock(time.now);
    clock.anchor(6_000);
    time.advance(30_000);
    expect(clock.remaining(26_000)).toBe(0);
  });

  it("reads deadlines against the browser clock alone before anchoring", () => {
    // Defensive: a deadline should never be rendered before the first view
    // arrives, but if it is, the offset is zero rather than undefined.
    const clock = createServerClock(fakeNow(1_000).now);
    expect(clock.remaining(3_000)).toBe(2_000);
  });
});
