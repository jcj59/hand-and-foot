/**
 * One lesson being played: the position, the step the learner is on, and what the
 * coach last said. Pure transitions, so the rules of a lesson — a move that does
 * not do what was asked is not played — can be asserted without rendering.
 */
import type { Action, GameState, LastMove, RoomInfo, ViewUpdate } from "@hf/shared";
import {
  applyAction,
  describeMove,
  heuristicPolicy,
  legalHints,
  moveSeenBy,
  project,
} from "@hf/engine";
import { LEARNER, lessonStart, TUTOR_NAMES, type Lesson } from "@hf/scenarios";

export interface LessonRun {
  readonly state: GameState;
  /** The step the learner is on; equal to the number of steps once the lesson is done. */
  readonly step: number;
  /** What the coach said about the last move, if it was not the one asked for. */
  readonly feedback: string | null;
  /** Moves played so far, which numbers the next one for the table's animations. */
  readonly seq: number;
  readonly lastMove: LastMove | null;
}

export function startRun(lesson: Lesson): LessonRun {
  return { state: lessonStart(lesson), step: 0, feedback: null, seq: 0, lastMove: null };
}

export function finished(lesson: Lesson, run: LessonRun): boolean {
  return run.step >= lesson.steps.length;
}

/**
 * The learner's move: played if the engine accepts it and it does what the step
 * asks; otherwise the position stays as it was and the coach says why. Returns
 * the run unchanged, but for the feedback, for any move that is not played.
 */
export function learnerMove(lesson: Lesson, run: LessonRun, action: Action): LessonRun {
  if (finished(lesson, run)) return run;
  const before = run.state;
  const result = applyAction(before, action);
  if (!result.ok) return { ...run, feedback: capitalize(result.error) + "." };
  const step = lesson.steps[run.step]!;
  if (!step.done(before, action, result.state)) return { ...run, feedback: step.hint };
  return played(run, LEARNER, action, result.state, run.step + 1);
}

/** The computer player's move, when it is its turn. */
export function computerMove(run: LessonRun): LessonRun {
  const state = run.state;
  if (state.roundEnded || state.currentSeat === LEARNER) return run;
  const seat = state.currentSeat;
  const action = heuristicPolicy(state, seat);
  const result = action && applyAction(state, action);
  /* v8 ignore next -- the heuristic only ever offers moves the reducer accepts */
  if (!action || !result || !result.ok) return run;
  return played(run, seat, action, result.state, run.step);
}

function played(
  run: LessonRun,
  seat: number,
  action: Action,
  after: GameState,
  step: number,
): LessonRun {
  const seq = run.seq + 1;
  return {
    state: after,
    step,
    feedback: null,
    seq,
    lastMove: describeMove(seq, seat, action, run.state, after) ?? run.lastMove,
  };
}

/** The table as the learner sees it: their own view, as a seat at a real table is sent. */
export function updateFor(lesson: Lesson, run: LessonRun): ViewUpdate {
  const room: RoomInfo = {
    roomId: "LEARN",
    players: TUTOR_NAMES.map((name, seat) => ({
      seat,
      name,
      connected: true,
      ...(seat === LEARNER ? {} : { bot: true as const }),
    })),
    hostSeat: LEARNER,
    started: true,
    // Nothing to pause or save: a lesson has no clock and no other players waiting.
    config: { ...lesson.config, pauseEnabled: false },
    playAgain: [],
    nextRoundReady: [],
  };
  return {
    view: project(run.state, LEARNER),
    clock: { serverNow: 0, deadlineAt: null, inDiscardGrace: false, paused: false },
    room,
    hints: legalHints(run.state, LEARNER),
    ...(run.lastMove ? { lastMove: moveSeenBy(run.lastMove, LEARNER) } : {}),
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
