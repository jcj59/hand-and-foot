import { describe, it, expect } from "vitest";
import { FakeClock, systemClock } from "./clock";

describe("systemClock", () => {
  it("reports real time and fires a real timer", async () => {
    const before = Date.now();
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);

    await new Promise<void>((resolve) => {
      systemClock.setTimer(1, resolve);
    });
  });

  it("cancels a timer that has not fired", async () => {
    let fired = false;
    const cancel = systemClock.setTimer(50, () => {
      fired = true;
    });
    cancel();
    // Comfortably past the deadline it would have fired at.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toBe(false);
  });
});

describe("FakeClock", () => {
  it("does not move on its own", () => {
    const clock = new FakeClock(1_000);
    expect(clock.now()).toBe(1_000);
    let fired = false;
    clock.setTimer(5, () => {
      fired = true;
    });
    expect(clock.now()).toBe(1_000);
    expect(fired).toBe(false);
  });

  it("fires a timer when time reaches it, and sets now to the timer's own instant", () => {
    const clock = new FakeClock(0);
    const seen: number[] = [];
    clock.setTimer(30, () => seen.push(clock.now()));
    clock.advance(100);
    // The callback must observe the moment it was due, not the end of the window,
    // or every deadline computed inside a timer would be skewed late.
    expect(seen).toEqual([30]);
    expect(clock.now()).toBe(100);
  });

  it("fires due timers in time order regardless of scheduling order", () => {
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimer(30, () => order.push("third"));
    clock.setTimer(10, () => order.push("first"));
    clock.setTimer(20, () => order.push("second"));
    clock.advance(50);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("leaves a timer beyond the window alone", () => {
    const clock = new FakeClock(0);
    let fired = false;
    clock.setTimer(100, () => {
      fired = true;
    });
    clock.advance(99);
    expect(fired).toBe(false);
    clock.advance(1);
    expect(fired).toBe(true);
  });

  it("fires a timer scheduled from inside another timer within the same advance", () => {
    // This is exactly the turn clock rolling into its discard grace: the expiry
    // callback schedules the grace timer. If that did not fire in the same
    // window, every M2c test would have to advance twice for one logical event.
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimer(10, () => {
      order.push("expiry");
      clock.setTimer(5, () => order.push("grace"));
    });
    clock.advance(100);
    expect(order).toEqual(["expiry", "grace"]);
  });

  it("does not fire a cancelled timer, and tolerates cancelling twice", () => {
    const clock = new FakeClock(0);
    let fired = false;
    const cancel = clock.setTimer(10, () => {
      fired = true;
    });
    cancel();
    cancel();
    clock.advance(100);
    expect(fired).toBe(false);
  });

  it("counts only timers still outstanding", () => {
    const clock = new FakeClock(0);
    clock.setTimer(10, () => undefined);
    const cancel = clock.setTimer(20, () => undefined);
    expect(clock.pendingCount()).toBe(2);

    cancel();
    expect(clock.pendingCount()).toBe(1);

    clock.advance(15);
    expect(clock.pendingCount()).toBe(0);
  });
});
