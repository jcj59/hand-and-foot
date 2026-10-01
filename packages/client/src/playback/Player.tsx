/**
 * Watch a game play itself on the real table: any timeline — a scenario, a golden
 * game, a recorded match — rendered through `TableView` from one seat's side, with
 * playback controls over it.
 *
 * It knows nothing about where the timeline came from, which is the point: the
 * scenario viewer is one caller, and replaying a stored match is meant to be
 * another with nothing here changed. Everything specific to scenarios — the list,
 * the URL, running them all — belongs to the caller.
 *
 * Moves played forward are shown as moves: cards slide, sounds play, Grabby Pants
 * is announced. A jump — scrubbing, stepping back, skipping to a moment, or the
 * instant speed — lands on the new position silently, because nothing happened
 * at the table; the position just changed.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Card } from "@hf/shared";
import type { Moment, Timeline } from "@hf/engine";
import { PlayingCard } from "../cards/PlayingCard";
import { TableView } from "../table/TableView";
import { usePhone } from "../usePhone";
import { frameAt } from "./frame";
import {
  describeStep,
  nextMoment,
  nextTurnStart,
  previousMoment,
  previousTurnStart,
  turnAt,
  turnEnd,
} from "./navigate";
import { SPEEDS, delayAt, initialPlayback, playbackReducer, type Speed } from "./playback";

export interface PlayerPosition {
  readonly step: number;
  readonly seat: number;
  readonly revealAll: boolean;
}

export interface PlayerProps {
  readonly timeline: Timeline;
  /** Shown at the top of the table. */
  readonly title?: string;
  /** Where to start: a step, and whose side of the table to watch. */
  readonly start?: Partial<PlayerPosition>;
  /** Play only this part, then stop (and call `onEnd`). The whole timeline otherwise. */
  readonly range?: { readonly from: number; readonly to: number };
  readonly autoplay?: boolean;
  readonly speed?: Speed;
  readonly onSpeedChange?: (speed: Speed) => void;
  /** Called when playing reaches the end of the range. */
  readonly onEnd?: () => void;
  /** Called as the position changes, so a caller can keep a link to it. */
  readonly onPositionChange?: (position: PlayerPosition) => void;
  readonly onMainMenu: () => void;
}

export function Player({
  timeline,
  title = "Replay",
  start = {},
  range,
  autoplay = false,
  speed = 1,
  onSpeedChange,
  onEnd,
  onPositionChange,
  onMainMenu,
}: PlayerProps): React.ReactElement {
  const [pb, dispatch] = useReducer(playbackReducer, undefined, () =>
    initialPlayback(timeline.length, {
      step: start.step ?? range?.from,
      from: range?.from,
      to: range?.to,
      playing: autoplay,
      speed,
    }),
  );
  const [seat, setSeat] = useState(() => clampSeat(start.seat ?? 0, timeline.playerCount));
  const [revealAll, setRevealAll] = useState(start.revealAll ?? false);
  // On a phone the jumps by turn, round and moment fold away, to leave the table room.
  const phone = usePhone();
  const [more, setMore] = useState(false);

  // Play: wait out the pause before the next move, then make it.
  useEffect(() => {
    if (!pb.playing || pb.step >= pb.to) return;
    const timer = setTimeout(
      () => dispatch({ type: "forward" }),
      delayAt(timeline, pb.step, pb.speed),
    );
    return () => clearTimeout(timer);
  }, [pb.playing, pb.step, pb.to, pb.speed, timeline]);

  // The end of the range, reached by playing rather than by seeking there.
  const wasPlaying = useRef(pb.playing);
  const lastTick = useRef(pb.ticks);
  const ended = useRef(onEnd);
  ended.current = onEnd;
  useEffect(() => {
    const played = pb.ticks !== lastTick.current;
    if (wasPlaying.current && played && !pb.playing && pb.step >= pb.to) ended.current?.();
    wasPlaying.current = pb.playing;
    lastTick.current = pb.ticks;
  }, [pb.playing, pb.step, pb.to, pb.ticks]);

  const position = useRef(onPositionChange);
  position.current = onPositionChange;
  useEffect(() => {
    position.current?.({ step: pb.step, seat, revealAll });
  }, [pb.step, seat, revealAll]);

  // Keys, for a developer stepping through a situation: space plays and pauses,
  // the arrows step, and with shift they jump between moments.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
      if (event.key === " ") dispatch({ type: "toggle" });
      else if (event.key === "ArrowRight" && event.shiftKey)
        seekTo(nextMoment(timeline, step.current));
      else if (event.key === "ArrowLeft" && event.shiftKey)
        seekTo(previousMoment(timeline, step.current));
      else if (event.key === "ArrowRight") dispatch({ type: "forward" });
      else if (event.key === "ArrowLeft") dispatch({ type: "back" });
      else return;
      event.preventDefault();
    };
    const seekTo = (m: Moment | null): void => {
      if (m) dispatch({ type: "seek", step: m.step });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeline]);
  const step = useRef(pb.step);
  step.current = pb.step;

  const frame = useMemo(
    () => frameAt(timeline, pb.step, seat, pb.playedAs, title),
    [timeline, pb.step, seat, pb.playedAs, title],
  );

  const seek = (to: number | null | undefined): void => {
    if (to !== null && to !== undefined) dispatch({ type: "seek", step: to });
  };
  const here = timeline.moments.filter((m) => m.step === pb.step);
  const turn = turnAt(timeline, pb.step);
  const state = timeline.stateAt(pb.step);

  return (
    <div className="flex h-full flex-col">
      <section
        aria-label="Playback"
        className="flex shrink-0 flex-col gap-1.5 border-b border-white/10 bg-black/25 px-2 py-1.5 text-sm sm:px-3"
      >
        <div className="flex flex-wrap items-center gap-1">
          <Control label="Back to the start" onClick={() => seek(pb.from)}>
            |◀
          </Control>
          <Control
            label="Previous moment"
            disabled={!previousMoment(timeline, pb.step)}
            onClick={() => seek(previousMoment(timeline, pb.step)?.step)}
          >
            ⇤
          </Control>
          <Control
            label="Step back"
            disabled={pb.step === 0}
            onClick={() => dispatch({ type: "back" })}
          >
            ◀
          </Control>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggle" })}
            className="min-w-16 rounded bg-amber-300 px-3 py-1 font-semibold text-black"
          >
            {pb.playing ? "Pause" : "Play"}
          </button>
          <Control
            label="Step forward"
            disabled={pb.step >= timeline.length}
            onClick={() => dispatch({ type: "forward" })}
          >
            ▶
          </Control>
          <Control
            label="Next moment"
            disabled={!nextMoment(timeline, pb.step)}
            onClick={() => seek(nextMoment(timeline, pb.step)?.step)}
          >
            ⇥
          </Control>
          <Control label="Jump to the end" onClick={() => seek(pb.to)}>
            ▶|
          </Control>
          <label className="ml-1 flex items-center gap-1 text-white/70">
            <span className="sr-only sm:not-sr-only">Speed</span>
            <select
              aria-label="Speed"
              value={String(pb.speed)}
              onChange={(e) => {
                const value = e.target.value;
                const next: Speed = value === "instant" ? "instant" : (Number(value) as Speed);
                dispatch({ type: "speed", speed: next });
                onSpeedChange?.(next);
              }}
              className="rounded border border-white/25 bg-felt-900 px-1 py-0.5"
            >
              {SPEEDS.map((s) => (
                <option key={String(s)} value={String(s)}>
                  {s === "instant" ? "Instant" : `${s}×`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-white/70">
            <span className="sr-only sm:not-sr-only">Watch</span>
            <select
              aria-label="Watch"
              value={seat}
              onChange={(e) => {
                setSeat(Number(e.target.value));
                // A different seat is a different view of the same moment, not a move.
                dispatch({ type: "seek", step: pb.step });
              }}
              className="rounded border border-white/25 bg-felt-900 px-1 py-0.5"
            >
              {Array.from({ length: timeline.playerCount }, (_, s) => (
                <option key={s} value={s}>
                  {timeline.nameOf(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-white/70">
            <input
              type="checkbox"
              checked={revealAll}
              onChange={(e) => setRevealAll(e.target.checked)}
            />
            Every hand
          </label>
          {phone && (
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore(!more)}
              className="rounded border border-white/20 px-2 py-0.5"
            >
              {more ? "Less" : "More"}
            </button>
          )}
          {(!phone || more) && (
            <>
              <span className="mx-1 hidden h-5 w-px bg-white/20 sm:inline-block" />
              <Control
                label="Previous turn"
                disabled={previousTurnStart(timeline, pb.step) === null}
                onClick={() => seek(previousTurnStart(timeline, pb.step))}
              >
                ‹ Turn
              </Control>
              <Control
                label="End of this turn"
                disabled={turnEnd(timeline, pb.step) === null}
                onClick={() => seek(turnEnd(timeline, pb.step))}
              >
                Turn end
              </Control>
              <Control
                label="Next turn"
                disabled={nextTurnStart(timeline, pb.step) === null}
                onClick={() => seek(nextTurnStart(timeline, pb.step))}
              >
                Turn ›
              </Control>
              <select
                aria-label="Jump to a round"
                value=""
                onChange={(e) => seek(Number(e.target.value))}
                className="rounded border border-white/25 bg-felt-900 px-1 py-0.5"
              >
                <option value="" disabled>
                  Round…
                </option>
                {timeline.rounds.flatMap((r) => [
                  <option key={`s${r.number}`} value={r.start}>
                    Round {r.number}: start
                  </option>,
                  <option key={`e${r.number}`} value={r.end}>
                    Round {r.number}: end
                  </option>,
                ])}
              </select>
              <select
                aria-label="Jump to a moment"
                value=""
                onChange={(e) => seek(Number(e.target.value))}
                className="max-w-[14rem] rounded border border-white/25 bg-felt-900 px-1 py-0.5"
              >
                <option value="" disabled>
                  Moments ({timeline.moments.length})…
                </option>
                {timeline.moments.map((m) => (
                  <option key={m.id} value={m.step}>
                    {m.kind === "named" ? "★ " : ""}
                    {m.label} (step {m.step})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <Scrubber timeline={timeline} step={pb.step} onSeek={seek} />

        <p aria-label="Position" className="text-xs text-white/70">
          Step {pb.step} of {timeline.length} · Round {state.roundNumber}
          {turn ? ` · ${timeline.nameOf(turn.seat)}'s turn` : ""} ·{" "}
          {describeStep(timeline, pb.step)}
          {here.length > 0 && (
            <span role="status" aria-label="Moment" className="ml-2 font-medium text-amber-200">
              {here.map((m) => `${m.kind === "named" ? "★ " : ""}${m.label}`).join(" · ")}
            </span>
          )}
        </p>
      </section>

      {revealAll && <EveryHand timeline={timeline} step={pb.step} />}

      <div className="min-h-0 flex-1">
        <TableView
          update={frame.update}
          room={frame.room}
          result={frame.result}
          notice={null}
          controls={null}
          onMainMenu={onMainMenu}
          quiet={pb.playedAs === null}
          heading={title}
        />
      </div>
    </div>
  );
}

function clampSeat(seat: number, count: number): number {
  return Number.isInteger(seat) && seat >= 0 && seat < count ? seat : 0;
}

function Control({
  label,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-white/20 px-2 py-0.5 whitespace-nowrap disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * The timeline as a slider, with the rounds marked and every moment a notch that
 * can be clicked — the named ones larger and in amber, since they are why the
 * game is being watched.
 */
function Scrubber({
  timeline,
  step,
  onSeek,
}: {
  readonly timeline: Timeline;
  readonly step: number;
  readonly onSeek: (step: number) => void;
}): React.ReactElement {
  const at = (s: number): string => `${timeline.length === 0 ? 0 : (s / timeline.length) * 100}%`;
  return (
    <div className="relative px-1 pt-3">
      <div className="pointer-events-none absolute inset-x-1 top-0 h-3">
        {timeline.rounds.slice(1).map((r) => (
          <span
            key={r.number}
            className="absolute top-0 h-6 w-px bg-white/40"
            style={{ left: at(r.start) }}
          />
        ))}
        {timeline.moments.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.label}
            aria-label={`Go to: ${m.label}`}
            onClick={() => onSeek(m.step)}
            className={`pointer-events-auto absolute -translate-x-1/2 rounded-full ${
              m.kind === "named"
                ? "top-0 h-3 w-3 bg-amber-300 ring-1 ring-black/40"
                : "top-1 h-1.5 w-1.5 bg-sky-300/80"
            }`}
            style={{ left: at(m.step) }}
          />
        ))}
      </div>
      <input
        type="range"
        aria-label="Timeline"
        min={0}
        max={timeline.length}
        value={step}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="w-full accent-amber-300"
      />
    </div>
  );
}

/** Everyone's cards, face up: what a replay may show that no seat at the table could see. */
function EveryHand({
  timeline,
  step,
}: {
  readonly timeline: Timeline;
  readonly step: number;
}): React.ReactElement {
  const state = timeline.stateAt(step);
  return (
    <section
      aria-label="Every hand"
      className="flex max-h-[30%] shrink-0 flex-col gap-1 overflow-y-auto border-b border-white/10 bg-black/15 px-3 py-1.5"
    >
      {state.players.map((p, s) => (
        <div key={s} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-16 shrink-0 truncate text-xs font-medium text-white/80">
            {timeline.nameOf(s)}
          </span>
          <Cards label={`${timeline.nameOf(s)}'s hand`} title="hand" cards={p.hand} />
          <Cards
            label={`${timeline.nameOf(s)}'s foot`}
            title={p.inFoot ? "foot (playing)" : "foot"}
            cards={p.foot}
          />
        </div>
      ))}
    </section>
  );
}

function Cards({
  label,
  title,
  cards,
}: {
  readonly label: string;
  readonly title: string;
  readonly cards: readonly Card[];
}): React.ReactElement {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <span className="text-[10px] tracking-wide text-white/50 uppercase">{title}</span>
      {cards.length === 0 ? (
        <span className="text-xs text-white/40">none</span>
      ) : (
        <div className="flex flex-wrap gap-0.5">
          {cards.map((card) => (
            <PlayingCard key={card.id} card={card} size="small" />
          ))}
        </div>
      )}
    </div>
  );
}
