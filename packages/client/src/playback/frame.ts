/**
 * One step of a timeline as the table component takes it: the `ViewUpdate` a
 * seat would have been sent at that point, and the room and scoreboard around it.
 *
 * It goes through the same projection the server uses — `project` for the view,
 * `legalHints` for the seat's options, `moveSeenBy` for the latest move — so the
 * table shows a replayed seat exactly what that seat saw, and nothing more. What
 * a replay may show beyond one seat's view (every hand, once a game is over) is
 * the player's to add on top, not something this lets through.
 */
import type { ClockState, RoomInfo, RoundEnded, ViewUpdate } from "@hf/shared";
import { isSeated, legalHints, moveSeenBy, project, roundResult, type Timeline } from "@hf/engine";

export interface Frame {
  readonly update: ViewUpdate;
  readonly room: RoomInfo;
  readonly result: RoundEnded | null;
}

/** A replay has no clock: nobody is waiting on a deadline. */
const NO_CLOCK: ClockState = {
  serverNow: 0,
  deadlineAt: null,
  inDiscardGrace: false,
  paused: false,
};

/**
 * The frame at `step`, from `seat`'s side of the table. `playedAs` is set when the
 * step was reached by playing forward, and numbers the move: the table animates,
 * sounds and announces a move only when it sees a number it has not seen, so a
 * step played again after seeking back gets a fresh one. A jump leaves it null
 * and the frame carries no move at all.
 */
export function frameAt(
  timeline: Timeline,
  step: number,
  seat: number,
  playedAs: number | null,
  heading = "Replay",
): Frame {
  const state = timeline.stateAt(step);
  const move = playedAs !== null && step > 0 ? timeline.entry(step).move : null;
  const room: RoomInfo = {
    roomId: heading,
    players: Array.from({ length: timeline.playerCount }, (_, s) => ({
      seat: s,
      name: timeline.nameOf(s),
      connected: true,
      ...(isSeated(state, s) ? {} : { departed: true as const }),
    })),
    hostSeat: 0,
    started: true,
    grabbyPants: timeline.grabbyAt(step),
    config: state.config,
    playAgain: [],
    nextRoundReady: [],
  };
  return {
    update: {
      view: project(state, seat),
      clock: NO_CLOCK,
      room,
      hints: legalHints(state, seat),
      ...(move ? { lastMove: { ...moveSeenBy(move, seat), seq: playedAs! } } : {}),
    },
    room,
    result: roundResult(state),
  };
}
