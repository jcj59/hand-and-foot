/**
 * Where the jump buttons go, worked out from the timeline alone. Pure, so the
 * edges — the first turn, the last moment, a step between rounds — are tested
 * without a screen.
 */
import type { Moment, Timeline, TurnSpan } from "@hf/engine";

/** The turn being played at `step`: the one on turn, or the one just finished at the end. */
export function turnAt(timeline: Timeline, step: number): TurnSpan | null {
  return (
    timeline.turns.find((t) => t.start <= step && step < t.end) ??
    timeline.turns.find((t) => t.end === step) ??
    null
  );
}

/** The start of this turn, or of the one before if already at the start. */
export function previousTurnStart(timeline: Timeline, step: number): number | null {
  const starts = timeline.turns.map((t) => t.start).filter((s) => s < step);
  return starts.length > 0 ? starts[starts.length - 1]! : null;
}

export function nextTurnStart(timeline: Timeline, step: number): number | null {
  return timeline.turns.find((t) => t.start > step)?.start ?? null;
}

/** The end of the turn on at `step`: everything that player did, done. */
export function turnEnd(timeline: Timeline, step: number): number | null {
  const turn = timeline.turns.find((t) => t.start <= step && step < t.end);
  return turn ? turn.end : null;
}

export function previousMoment(timeline: Timeline, step: number): Moment | null {
  const before = timeline.moments.filter((m) => m.step < step);
  return before.length > 0 ? before[before.length - 1]! : null;
}

export function nextMoment(timeline: Timeline, step: number): Moment | null {
  return timeline.moments.find((m) => m.step > step) ?? null;
}

/** Find a moment by the id a link names: a named moment's own id, or a found one's. */
export function momentById(timeline: Timeline, id: string): Moment | null {
  return timeline.moments.find((m) => m.id === id) ?? null;
}

/** Say in a few words what happened at `step`, for the status line. */
export function describeStep(timeline: Timeline, step: number): string {
  if (step === 0) return "The start";
  const { seat, action } = timeline.entry(step);
  const name = timeline.nameOf(seat);
  switch (action.type) {
    case "draw":
      return `${name} drew`;
    case "takePile":
      return `${name} took the pile`;
    case "playMelds":
      return `${name} melded`;
    case "takeBack":
      return `${name} took back their melds`;
    case "discard":
      return `${name} discarded`;
    case "nextRound":
      return `Round ${timeline.stateAt(step).roundNumber} dealt`;
  }
}
