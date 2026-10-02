import { describe, it, expect } from "vitest";
import { SCENARIOS, scenarioById } from "@hf/scenarios";
import { AFTER_MOMENT, BEFORE_MOMENT, playlist, timelineOf } from "./catalog";

describe("the scenario catalog", () => {
  it("builds each timeline once", () => {
    const s = scenarioById("marva")!;
    expect(timelineOf(s)).toBe(timelineOf(s));
  });

  it("plays every scenario whole, in order, for run all", () => {
    const items = playlist(false);
    expect(items.map((i) => i.scenario.id)).toEqual(SCENARIOS.map((s) => s.id));
    for (const item of items) {
      expect(item).toMatchObject({ from: 0, to: timelineOf(item.scenario).length });
    }
  });

  it("plays a window around each named moment, joining windows that overlap", () => {
    expect([BEFORE_MOMENT, AFTER_MOMENT]).toEqual([6, 3]);
    const items = playlist(true);
    for (const scenario of SCENARIOS) {
      const t = timelineOf(scenario);
      const windows = items.filter((i) => i.scenario === scenario);
      for (const m of t.moments.filter((x) => x.kind === "named")) {
        expect(windows.some((w) => w.from <= m.step && m.step <= w.to)).toBe(true);
      }
      windows.forEach((w, i) => {
        expect(w.from).toBeGreaterThanOrEqual(0);
        expect(w.to).toBeLessThanOrEqual(t.length);
        if (i > 0) expect(w.from).toBeGreaterThan(windows[i - 1]!.to);
      });
    }
    // A scenario with no named moments has nothing to show in this mode.
    expect(items.some((i) => i.scenario.id === "match")).toBe(false);
    // Grabby Pants: earned, then taken and kept close together, then a round later
    // the lapse — three windows.
    expect(items.filter((i) => i.scenario.id === "grabby-pants")).toHaveLength(3);
  });
});
