import { describe, expect, it } from "vitest";
import { PULSE_PERIOD_MS, pulseStyle } from "./pulse";

describe("pulseStyle", () => {
  it("starts every pulse at the same point of a shared cycle", () => {
    // Two elements appearing at different moments land on the same phase.
    const a = pulseStyle(10_000);
    const b = pulseStyle(10_000 + PULSE_PERIOD_MS * 3);
    expect(a).toEqual(b);
  });

  it("is a negative delay of how far into the cycle the clock is", () => {
    expect(pulseStyle(PULSE_PERIOD_MS * 5 + 250)).toEqual({ animationDelay: "-250ms" });
  });

  it("runs on a 1.4 second cycle", () => {
    // Pinned as a literal: index.css declares the same period and must agree.
    expect(PULSE_PERIOD_MS).toBe(1400);
  });
});
