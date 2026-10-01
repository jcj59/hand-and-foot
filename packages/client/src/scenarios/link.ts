/**
 * Scenario links: `/scenarios/marva#moment=getdown`, or `#step=12&seat=1&all=1`.
 * Kept in the fragment so that a link names a point in a scenario without the
 * server, or the router, having to know anything about it.
 */
import { momentById } from "../playback/navigate";
import type { Timeline } from "@hf/engine";

export interface ScenarioLink {
  readonly step?: number;
  readonly momentId?: string;
  readonly seat?: number;
  readonly revealAll?: boolean;
}

export function parseLink(hash: string): ScenarioLink {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const int = (key: string): number | undefined => {
    const raw = params.get(key);
    if (raw === null || !/^\d+$/.test(raw)) return undefined;
    return Number(raw);
  };
  const step = int("step");
  const seat = int("seat");
  const momentId = params.get("moment") ?? undefined;
  return {
    ...(step !== undefined ? { step } : {}),
    ...(momentId ? { momentId } : {}),
    ...(seat !== undefined ? { seat } : {}),
    ...(params.get("all") === "1" ? { revealAll: true } : {}),
  };
}

/** Where a link points, in a timeline: a moment wins over a bare step; out of range is ignored. */
export function stepFor(timeline: Timeline, link: ScenarioLink): number | undefined {
  if (link.momentId !== undefined) {
    const moment = momentById(timeline, link.momentId);
    if (moment) return moment.step;
  }
  if (link.step !== undefined && link.step <= timeline.length) return link.step;
  return undefined;
}

/**
 * The fragment for a position: the named moment there if there is one, since that
 * survives a change to the script before it, and the step otherwise.
 */
export function formatLink(
  timeline: Timeline,
  position: { step: number; seat: number; revealAll: boolean },
  defaultSeat: number,
): string {
  const named = timeline.moments.find((m) => m.kind === "named" && m.step === position.step);
  const params = new URLSearchParams();
  if (named) params.set("moment", named.id);
  else params.set("step", String(position.step));
  if (position.seat !== defaultSeat) params.set("seat", String(position.seat));
  if (position.revealAll) params.set("all", "1");
  return `#${params.toString()}`;
}
