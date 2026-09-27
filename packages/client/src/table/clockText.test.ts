import { describe, it, expect } from "vitest";
import { formatRemaining, isUrgent, NO_DEADLINE, URGENT_MS } from "./clockText";

describe("formatRemaining", () => {
  it("shows a dash when there is no deadline", () => {
    // A paused table and an undealt one both send null; neither is zero seconds.
    expect(formatRemaining(null)).toBe(NO_DEADLINE);
  });

  it("formats whole seconds", () => {
    expect(formatRemaining(30_000)).toBe("0:30");
    expect(formatRemaining(9_000)).toBe("0:09");
  });

  it("pads the seconds", () => {
    expect(formatRemaining(65_000)).toBe("1:05");
  });

  it("counts minutes past sixty seconds", () => {
    expect(formatRemaining(90_000)).toBe("1:30");
    expect(formatRemaining(600_000)).toBe("10:00");
  });

  it("rounds up, so any time left never reads as none", () => {
    // Rounding down would show 0:00 for a whole second while moves were still being
    // accepted, which looks like a fault exactly when a player is hurrying.
    expect(formatRemaining(1)).toBe("0:01");
    expect(formatRemaining(7_400)).toBe("0:08");
    expect(formatRemaining(59_001)).toBe("1:00");
  });

  it("shows zero only when the time really is gone", () => {
    expect(formatRemaining(0)).toBe("0:00");
  });

  it("treats an overdue deadline as zero rather than negative", () => {
    // `remaining` already floors at zero, but a clock that could render "-0:03" is
    // not worth leaving possible.
    expect(formatRemaining(-5_000)).toBe("0:00");
  });
});

describe("isUrgent", () => {
  it("is quiet with plenty of time", () => {
    expect(isUrgent(30_000)).toBe(false);
  });

  it("warns at and below the threshold", () => {
    expect(isUrgent(URGENT_MS)).toBe(true);
    expect(isUrgent(URGENT_MS - 1)).toBe(true);
    expect(isUrgent(0)).toBe(true);
  });

  it("stays quiet just above the threshold", () => {
    expect(isUrgent(URGENT_MS + 1)).toBe(false);
  });

  it("is never urgent without a deadline", () => {
    // A paused table is the opposite of urgent; flashing at a player who cannot act
    // would be noise.
    expect(isUrgent(null)).toBe(false);
  });

  it("warns ten seconds out", () => {
    // Pinned as a literal rather than against the constant, which the assertions
    // above reference symbolically and so would move with it.
    expect(URGENT_MS).toBe(10_000);
  });
});
