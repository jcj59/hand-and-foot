/**
 * A game as something to watch: any starting position and the actions applied to
 * it, turned into a timeline that can be played forward, scrubbed, stepped
 * backward, and jumped to a turn, a round, or a moment that matters.
 *
 * It is deliberately indifferent to where the game came from. A scripted scenario,
 * a golden game from the tests and a match recorded by the server all reduce to
 * the same `GameLog`, and everything the player shows — the state at a step, the
 * move that led there, who held Grabby Pants, where each turn and round begins and
 * ends, and the moments worth jumping to — is worked out from that alone.
 *
 * Seeking is cheap because the engine is a pure reducer: the state at step `n` is
 * the setup with the first `n` actions folded over it. The timeline keeps a state
 * every `CHECKPOINT_EVERY` steps and replays forward from the nearest one, so a
 * jump costs at most that many reductions and a whole match is never held in
 * memory at once. Playing forward one step at a time reuses the state it just
 * produced.
 */
import type { Action, GameState, GrabbyPants, LastMove, RulesConfig } from "@hf/shared";
import { deal } from "./deal";
import { grabbyHistory } from "./grabby";
import { describeMove } from "./lastMove";
import { isMatchOver } from "./nextRound";
import { applyAction } from "./reducer";

/** Where a game starts: a fresh deal from a seed, or a position built by hand. */
export type GameSetup =
  { readonly seed: number; readonly playerCount: number } | { readonly state: GameState };

/** A point someone marked by hand as the reason to watch: "Marva get-down". */
export interface MarkedMoment {
  /** Short and stable, for links: `#moment=getdown`. */
  readonly id: string;
  readonly label: string;
  /** The step it is seen at: the state once this many actions have been applied. */
  readonly step: number;
}

/** Everything a game is, for watching it: the rules, the start, and what was played. */
export interface GameLog {
  readonly config: RulesConfig;
  /** A hand-built state is played under `config`, whatever config it carried. */
  readonly setup: GameSetup;
  readonly actions: readonly Action[];
  /** Players' names by seat; "Seat n" for any not given. */
  readonly names?: readonly string[];
  readonly moments?: readonly MarkedMoment[];
}

/**
 * What kind of thing happened. `named` is a moment from the log; every other kind
 * is found by the timeline itself, in any game, whether or not anyone marked it.
 */
export type MomentKind =
  | "named"
  | "gotDown"
  | "pileTaken"
  | "footPickedUp"
  | "grabbyPants"
  | "wentOut"
  | "roundEnded"
  | "matchOver";

export interface Moment {
  readonly id: string;
  readonly kind: MomentKind;
  readonly label: string;
  readonly step: number;
  /** The player it is about, when it is about one. */
  readonly seat?: number;
}

/** One player's turn: on turn at `start`, and done by `end`. */
export interface TurnSpan {
  readonly round: number;
  readonly seat: number;
  readonly start: number;
  readonly end: number;
}

/** A round: dealt at `start`, over at `end` — or the last step, if it never finished. */
export interface RoundSpan {
  readonly number: number;
  readonly start: number;
  readonly end: number;
}

/** What led to a step: the action, the seat it was applied to, and what the table said. */
export interface StepEntry {
  readonly seat: number;
  readonly action: Action;
  /**
   * The move as the table announced it, with `seq` the step number. The full
   * truth: a draw names its card, so a view has to pass it through `moveSeenBy`.
   * Null for dealing the next round, which is not a move.
   */
  readonly move: LastMove | null;
}

/** A refused action: the log is not a game the engine will play. */
export class TimelineError extends Error {
  /** The step the refused action would have produced. */
  readonly step: number;
  constructor(step: number, message: string) {
    super(message);
    this.name = "TimelineError";
    this.step = step;
  }
}

/** How often the timeline keeps a whole state, in steps. */
export const CHECKPOINT_EVERY = 32;

export interface Timeline {
  readonly log: GameLog;
  /** The number of actions; steps run from 0 (the setup) to this. */
  readonly length: number;
  readonly playerCount: number;
  /** The state once `step` actions have been applied. */
  stateAt(step: number): GameState;
  /** What led to `step`, for steps 1 and later. */
  entry(step: number): StepEntry;
  /** Who held Grabby Pants at `step`. */
  grabbyAt(step: number): GrabbyPants | null;
  nameOf(seat: number): string;
  /** Every moment, named and found, in step order. */
  readonly moments: readonly Moment[];
  readonly turns: readonly TurnSpan[];
  readonly rounds: readonly RoundSpan[];
}

function initialState(log: GameLog): GameState {
  if ("state" in log.setup) return { ...log.setup.state, config: log.config };
  return deal(log.setup.playerCount, log.config, log.setup.seed);
}

/**
 * Play a log through once, checking every action and recording what the timeline
 * needs. Throws `TimelineError` at the first action the engine refuses — a
 * scenario that no longer replays is a failure, not something to show partly.
 */
export function buildTimeline(log: GameLog): Timeline {
  const start = initialState(log);
  const playerCount = start.players.length;
  const nameOf = (seat: number): string => log.names?.[seat] ?? `Seat ${seat}`;

  const checkpoints: GameState[] = [start];
  const entries: StepEntry[] = [];
  const found: Moment[] = [];
  const turns: TurnSpan[] = [];
  const rounds: RoundSpan[] = [];
  let roundStart = 0;
  // Where the turn being played began. After a round ends the only action the
  // engine accepts is dealing the next, which starts the next turn, so this never
  // needs to say "no turn".
  let turnStart = 0;
  // A position built at the end of a round: that round is over before anything is played.
  if (start.roundEnded) rounds.push({ number: start.roundNumber, start: 0, end: 0 });

  const note = (kind: MomentKind, step: number, label: string, seat?: number): void => {
    const id = seat === undefined ? `${kind}-${step}` : `${kind}-${step}-${seat}`;
    found.push({ id, kind, label, step, ...(seat === undefined ? {} : { seat }) });
  };

  let state = start;
  log.actions.forEach((action, index) => {
    const step = index + 1;
    const seat = state.currentSeat;
    const r = applyAction(state, action);
    if (!r.ok) {
      throw new TimelineError(
        step,
        `action ${step} (${action.type} by ${nameOf(seat)}) was refused: ${r.error}`,
      );
    }
    const next = r.state;
    entries.push({ seat, action, move: describeMove(step, seat, action, state, next) });

    if (action.type === "nextRound") {
      roundStart = step;
      turnStart = step;
    } else {
      if (action.type === "takePile") {
        note("pileTaken", step, `${nameOf(seat)} took the pile (${state.discard.length})`, seat);
      }
      next.players.forEach((after, s) => {
        const before = state.players[s]!;
        if (after.isDown && !before.isDown) note("gotDown", step, `${nameOf(s)} got down`, s);
        if (after.inFoot && !before.inFoot) {
          note("footPickedUp", step, `${nameOf(s)} picked up the foot`, s);
        }
      });
      if (next.wentOutSeat !== undefined && state.wentOutSeat === undefined) {
        note("wentOut", step, `${nameOf(next.wentOutSeat)} went out`, next.wentOutSeat);
      }
      // A turn is over when it passes to someone else or the round ends; the next
      // one starts right there.
      if (next.currentSeat !== seat || next.roundEnded) {
        turns.push({ round: state.roundNumber, seat, start: turnStart, end: step });
        turnStart = step;
      }
      // Any action other than dealing is refused once a round is over, so a round
      // that has ended here ended with this action.
      if (next.roundEnded) {
        note("roundEnded", step, `Round ${next.roundNumber} ended`);
        rounds.push({ number: next.roundNumber, start: roundStart, end: step });
        if (isMatchOver(next)) note("matchOver", step, "The match is over");
      }
    }

    state = next;
    if (step % CHECKPOINT_EVERY === 0) checkpoints.push(state);
  });

  const length = log.actions.length;
  if (!state.roundEnded) {
    rounds.push({ number: state.roundNumber, start: roundStart, end: length });
    if (turnStart < length) {
      turns.push({
        round: state.roundNumber,
        seat: state.currentSeat,
        start: turnStart,
        end: length,
      });
    }
  }

  const grabby = grabbyHistory(entries);
  grabby.forEach((holder, step) => {
    const was = step > 0 ? grabby[step - 1] : null;
    if (!holder || holder.seat === was?.seat) return;
    note(
      "grabbyPants",
      step,
      holder.from === undefined
        ? `${nameOf(holder.seat)} is Grabby Pants`
        : `${nameOf(holder.seat)} takes Grabby Pants from ${nameOf(holder.from)}`,
      holder.seat,
    );
  });

  const named: Moment[] = (log.moments ?? []).map((m) => {
    if (!Number.isInteger(m.step) || m.step < 0 || m.step > length) {
      throw new TimelineError(
        m.step,
        `moment "${m.id}" is at step ${m.step}, outside 0..${length}`,
      );
    }
    return { id: m.id, kind: "named", label: m.label, step: m.step };
  });
  const ids = new Set<string>();
  for (const m of named) {
    if (ids.has(m.id)) throw new TimelineError(m.step, `moment "${m.id}" is marked twice`);
    ids.add(m.id);
  }
  // Named moments first at a step: they are why the step is worth stopping at.
  const order: Record<MomentKind, number> = {
    named: 0,
    pileTaken: 1,
    gotDown: 2,
    footPickedUp: 3,
    grabbyPants: 4,
    wentOut: 5,
    roundEnded: 6,
    matchOver: 7,
  };
  const moments = [...named, ...found].sort(
    (a, b) => a.step - b.step || order[a.kind] - order[b.kind],
  );

  // The last state asked for, so playing forward a step at a time costs one
  // reduction per step rather than a replay from the checkpoint. Used only when it
  // is no further back than the checkpoint — either gives the same state, but the
  // checkpoint is then the shorter replay.
  let cached = { step: length, state };
  const check = (step: number): void => {
    if (!Number.isInteger(step) || step < 0 || step > length) {
      throw new RangeError(`step ${step} is outside 0..${length}`);
    }
  };

  return {
    log,
    length,
    playerCount,
    nameOf,
    moments,
    turns,
    rounds,
    stateAt(step) {
      check(step);
      const base = Math.floor(step / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
      let at =
        cached.step <= step && cached.step >= base
          ? cached
          : { step: base, state: checkpoints[base / CHECKPOINT_EVERY]! };
      while (at.step < step) {
        const r = applyAction(at.state, log.actions[at.step]!);
        /* v8 ignore next -- the build pass applied this same action to this same state */
        if (!r.ok) throw new TimelineError(at.step + 1, r.error);
        at = { step: at.step + 1, state: r.state };
      }
      cached = at;
      return at.state;
    },
    entry(step) {
      check(step);
      if (step === 0) throw new RangeError("nothing leads to step 0: it is the setup");
      return entries[step - 1]!;
    },
    grabbyAt(step) {
      check(step);
      return grabby[step]!;
    },
  };
}
