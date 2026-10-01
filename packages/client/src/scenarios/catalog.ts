/**
 * The scenario library, as timelines the player can take, built once each on
 * first use: building replays every action, and the viewer asks for the same
 * scenario on every render.
 */
import { buildTimeline, type Timeline } from "@hf/engine";
import { SCENARIOS, buildScenario, type Scenario } from "@hf/scenarios";

const built = new Map<string, Timeline>();

export function timelineOf(scenario: Scenario): Timeline {
  let timeline = built.get(scenario.id);
  if (!timeline) {
    timeline = buildTimeline(buildScenario(scenario));
    built.set(scenario.id, timeline);
  }
  return timeline;
}

/** Steps on either side of a moment that "run all" plays when showing moments only. */
export const BEFORE_MOMENT = 6;
export const AFTER_MOMENT = 3;

export interface PlaylistItem {
  readonly scenario: Scenario;
  readonly from: number;
  readonly to: number;
}

/**
 * What "run all" plays: every scenario whole, or only a window around each of its
 * named moments, with windows that overlap joined into one.
 */
export function playlist(
  momentsOnly: boolean,
  scenarios: readonly Scenario[] = SCENARIOS,
): PlaylistItem[] {
  return scenarios.flatMap((scenario) => {
    const timeline = timelineOf(scenario);
    if (!momentsOnly) return [{ scenario, from: 0, to: timeline.length }];
    const windows: PlaylistItem[] = [];
    for (const m of timeline.moments.filter((x) => x.kind === "named")) {
      const from = Math.max(0, m.step - BEFORE_MOMENT);
      const to = Math.min(timeline.length, m.step + AFTER_MOMENT);
      const last = windows[windows.length - 1];
      if (last && from <= last.to)
        windows[windows.length - 1] = { ...last, to: Math.max(last.to, to) };
      else windows.push({ scenario, from, to });
    }
    return windows;
  });
}
