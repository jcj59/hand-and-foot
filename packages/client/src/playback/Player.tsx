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
import { Icon, ICONS } from "../ui/icons";
import { TableView } from "../table/TableView";
import { usePhone } from "../usePhone";
import { frameAt } from "./frame";
import {
  describeStep,
  nextMoment,
  nextTurnStart,
  previousMoment,
  previousTurnStart,
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
  /** Words for what led to each step: the demo game's narration. */
  readonly narrate?: (step: number) => string;
  /** The way out's name on a computer, where it is written beside the arrow. */
  readonly backLabel?: string;
  /**
   * The extra controls for looking into a game: jumps by moment, turn and round,
   * the ends, and every hand face up. A replay and the scenario viewer have them;
   * the demo game, made to be sat back and watched, does not.
   */
  readonly tools?: boolean;
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
  narrate,
  backLabel = "Back",
  tools = true,
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
  // The narration on a phone, which can be put away to see more of the table.
  const [captions, setCaptions] = useState(true);

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
  const state = timeline.stateAt(pb.step);

  const watching = (
    <label className="flex min-w-0 shrink items-center gap-2 text-[13px] text-muted max-md:ml-auto max-md:min-h-10 max-md:rounded-xl max-md:border max-md:border-white/12 max-md:bg-surface max-md:pl-3 max-md:text-ink">
      {/* A phone has no room for the word beside a computer's two-word name. */}
      {phone ? <Icon name="eye" size={16} className="shrink-0 text-muted" /> : "Watching"}
      <select
        aria-label="Watch"
        value={seat}
        onChange={(e) => {
          setSeat(Number(e.target.value));
          // A different seat is a different view of the same moment, not a move.
          dispatch({ type: "seek", step: pb.step });
        }}
        className="min-h-[38px] max-w-[9rem] min-w-0 rounded-[10px] border border-white/12 bg-surface px-2.5 text-sm font-medium text-ink max-md:min-h-0 max-md:border-0 max-md:bg-transparent max-md:pl-0"
      >
        {Array.from({ length: timeline.playerCount }, (_, s) => (
          <option key={s} value={s}>
            {timeline.nameOf(s)}
          </option>
        ))}
      </select>
    </label>
  );

  const header = (
    <header
      className={`flex shrink-0 items-center gap-3 ${
        phone ? "px-5 py-3.5" : "flex-wrap gap-3.5 border-b border-white/6 px-7 py-4"
      }`}
    >
      {phone ? (
        <button
          type="button"
          aria-label={backLabel}
          onClick={onMainMenu}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-white/8 bg-surface"
        >
          <Icon name="back" size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onMainMenu}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 pr-3.5 pl-2.5 text-sm font-medium text-ink-soft hover:bg-white/4"
        >
          <Icon name="back" size={18} />
          {backLabel}
        </button>
      )}
      <div className={phone ? "shrink-0" : "min-w-0 flex-1"}>
        <h1
          className={`m-0 truncate font-display font-semibold ${phone ? "text-base" : "text-xl"}`}
        >
          {title}
        </h1>
        <p
          aria-label="Position"
          className="m-0 text-xs whitespace-nowrap text-muted md:text-[13px]"
        >
          Round {state.roundNumber} · move {pb.step} of {timeline.length}
        </p>
      </div>
      {watching}
    </header>
  );

  // What the narration says at a step: what happened, and why where it can tell.
  const said = (s: number): { readonly head: string; readonly body: string } => ({
    head: s === 0 ? "The deal" : describeStep(timeline, s),
    body: narrate ? narrate(s) : "",
  });
  const now = said(pb.step);

  // On a computer, the last few moves in words, in the table's side panel.
  const happening = narrate
    ? () => (
        <section aria-label="What's happening" className="flex flex-col gap-2.5">
          <h2 className="m-0 text-xs font-semibold tracking-[0.08em] text-faint uppercase">
            What&rsquo;s happening
          </h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {[pb.step - 2, pb.step - 1, pb.step]
              .filter((s) => s >= 0)
              .map((s) => {
                const latest = s === pb.step;
                const line = said(s);
                return (
                  <li
                    key={s}
                    aria-label={latest ? "Narration" : undefined}
                    aria-live={latest ? "polite" : undefined}
                    className={`rounded-[14px] px-2.5 py-2 ${
                      latest ? "border border-accent/40 bg-accent/6" : "border border-transparent"
                    }`}
                  >
                    <span
                      className={`block text-[13px] font-semibold ${
                        latest ? "text-accent" : "text-quiet"
                      }`}
                    >
                      {line.head}
                    </span>
                    <span className="mt-1 block text-sm leading-[1.45] text-ink-soft">
                      {line.body}
                    </span>
                  </li>
                );
              })}
          </ol>
        </section>
      )
    : undefined;

  // On a phone, the latest move in words, between the table and the controls.
  const caption = narrate && phone && captions && (
    <section
      aria-label="Narration"
      aria-live="polite"
      className="mx-3 mt-2.5 shrink-0 rounded-2xl border border-white/6 bg-surface px-3.5 py-3"
    >
      <p className="m-0 text-xs font-semibold text-accent">{now.head}</p>
      <p className="m-0 mt-0.5 text-[13px] leading-[1.45] text-[#D5DADF]">{now.body}</p>
    </section>
  );

  const speedControl = (
    <select
      aria-label="Speed"
      value={String(pb.speed)}
      onChange={(e) => {
        const value = e.target.value;
        const next: Speed = value === "instant" ? "instant" : (Number(value) as Speed);
        dispatch({ type: "speed", speed: next });
        onSpeedChange?.(next);
      }}
      className={`${OUTLINED} appearance-none bg-transparent text-center text-sm font-semibold`}
    >
      {SPEEDS.map((s) => (
        <option key={String(s)} value={String(s)} className="bg-surface">
          {s === "instant" ? "Max" : `${s}×`}
        </option>
      ))}
    </select>
  );

  const transport = (
    <div className={`flex items-center ${phone ? "gap-3" : "gap-2.5"}`}>
      <RoundButton
        label="Step back"
        disabled={pb.step === 0}
        onClick={() => dispatch({ type: "back" })}
        size={phone ? 46 : 44}
      >
        <Glyph d={ICONS.skipBack} size={phone ? 18 : 16} />
      </RoundButton>
      <button
        type="button"
        onClick={() => dispatch({ type: "toggle" })}
        aria-label={pb.playing ? "Pause" : "Play"}
        className="flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink hover:bg-accent-hover"
        style={{ width: phone ? 58 : 54, height: phone ? 58 : 54 }}
      >
        <Glyph d={pb.playing ? ICONS.pause : ICONS.play} size={phone ? 22 : 20} />
      </button>
      <RoundButton
        label="Step forward"
        disabled={pb.step >= timeline.length}
        onClick={() => dispatch({ type: "forward" })}
        size={phone ? 46 : 44}
      >
        <Glyph d={ICONS.skipForward} size={phone ? 18 : 16} />
      </RoundButton>
    </div>
  );

  const scrubber = <Scrubber timeline={timeline} step={pb.step} onSeek={seek} notches={tools} />;

  const toolRow = tools && (!phone || more) && (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tool label="Back to the start" onClick={() => seek(pb.from)}>
        Start
      </Tool>
      <Tool
        label="Previous moment"
        disabled={!previousMoment(timeline, pb.step)}
        onClick={() => seek(previousMoment(timeline, pb.step)?.step)}
      >
        ‹ Moment
      </Tool>
      <Tool
        label="Next moment"
        disabled={!nextMoment(timeline, pb.step)}
        onClick={() => seek(nextMoment(timeline, pb.step)?.step)}
      >
        Moment ›
      </Tool>
      <Tool label="Jump to the end" onClick={() => seek(pb.to)}>
        End
      </Tool>
      <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-white/12 md:inline-block" />
      <Tool
        label="Previous turn"
        disabled={previousTurnStart(timeline, pb.step) === null}
        onClick={() => seek(previousTurnStart(timeline, pb.step))}
      >
        ‹ Turn
      </Tool>
      <Tool
        label="End of this turn"
        disabled={turnEnd(timeline, pb.step) === null}
        onClick={() => seek(turnEnd(timeline, pb.step))}
      >
        Turn end
      </Tool>
      <Tool
        label="Next turn"
        disabled={nextTurnStart(timeline, pb.step) === null}
        onClick={() => seek(nextTurnStart(timeline, pb.step))}
      >
        Turn ›
      </Tool>
      <select
        aria-label="Jump to a round"
        value=""
        onChange={(e) => seek(Number(e.target.value))}
        className={TOOL}
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
        className={`${TOOL} max-w-[14rem]`}
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
      <label className={`${TOOL} flex items-center gap-2`}>
        <input
          type="checkbox"
          checked={revealAll}
          onChange={(e) => setRevealAll(e.target.checked)}
          className="accent-accent"
        />
        Every hand
      </label>
      {here.length > 0 && (
        <span role="status" aria-label="Moment" className="text-[13px] font-semibold text-gold">
          {here.map((m) => `${m.kind === "named" ? "★ " : ""}${m.label}`).join(" · ")}
        </span>
      )}
    </div>
  );

  const playback = (
    <section
      aria-label="Playback"
      className={`flex shrink-0 flex-col ${
        phone
          ? "gap-2.5 px-5 pt-2.5 pb-[calc(1.4rem+env(safe-area-inset-bottom,0px))]"
          : "gap-3 border-t border-white/6 px-7 pt-3 pb-5"
      }`}
    >
      {phone ? (
        <>
          {scrubber}
          <div className="flex items-center justify-between">
            {speedControl}
            {transport}
            {narrate ? (
              <button
                type="button"
                aria-label={captions ? "Hide explanations" : "Show explanations"}
                aria-pressed={captions}
                onClick={() => setCaptions(!captions)}
                className={`${OUTLINED} text-sm font-semibold ${captions ? "" : "text-muted"}`}
              >
                CC
              </button>
            ) : tools ? (
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore(!more)}
                className={`${OUTLINED} text-sm font-semibold`}
              >
                {more ? "Less" : "More"}
              </button>
            ) : (
              <span className="w-14" />
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-[18px]">
          {transport}
          <div className="min-w-[300px] flex-1">{scrubber}</div>
          {speedControl}
        </div>
      )}
      {toolRow}
    </section>
  );

  return (
    <div className="flex h-full flex-col bg-page text-ink">
      <div className="flex min-h-0 flex-1 flex-col">
        <TableView
          update={frame.update}
          room={frame.room}
          result={frame.result}
          notice={null}
          controls={null}
          onMainMenu={onMainMenu}
          quiet={pb.playedAs === null}
          heading={title}
          header={
            <>
              {header}
              {revealAll && <EveryHand timeline={timeline} step={pb.step} />}
            </>
          }
          aside={happening}
          onFelt
        />
      </div>
      {caption}
      {playback}
    </div>
  );
}

/** A quiet outlined square, as the design draws the speed and caption buttons. */
const OUTLINED =
  "flex min-h-11 min-w-14 items-center justify-center rounded-xl border border-white/12 px-2 text-ink";

/** The developer's extra controls: small outlined pills. */
const TOOL =
  "min-h-9 rounded-[10px] border border-white/12 bg-transparent px-3 text-[13px] whitespace-nowrap text-ink-soft hover:bg-white/4 disabled:opacity-30";

function Glyph({ d, size }: { readonly d: string; readonly size: number }): React.ReactElement {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d={d} />
    </svg>
  );
}

function RoundButton({
  label,
  disabled,
  onClick,
  size,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly size: number;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink hover:bg-selected disabled:opacity-35"
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

function clampSeat(seat: number, count: number): number {
  return Number.isInteger(seat) && seat >= 0 && seat < count ? seat : 0;
}

function Tool({
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
      className={TOOL}
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
  notches,
}: {
  readonly timeline: Timeline;
  readonly step: number;
  readonly onSeek: (step: number) => void;
  /** Mark the rounds and moments over it, to jump to. */
  readonly notches: boolean;
}): React.ReactElement {
  const at = (s: number): string => `${timeline.length === 0 ? 0 : (s / timeline.length) * 100}%`;
  return (
    <div className={`relative px-1 ${notches ? "pt-3" : ""}`}>
      {notches && (
        <div className="pointer-events-none absolute inset-x-1 top-0 h-3">
          {timeline.rounds.slice(1).map((r) => (
            <span
              key={r.number}
              className="absolute top-0 h-6 w-px bg-white/30"
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
                  ? "top-0 h-3 w-3 bg-gold ring-1 ring-black/40"
                  : "top-1 h-1.5 w-1.5 bg-blue/80"
              }`}
              style={{ left: at(m.step) }}
            />
          ))}
        </div>
      )}
      <input
        type="range"
        aria-label="Timeline"
        min={0}
        max={timeline.length}
        value={step}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="block w-full accent-accent"
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
      className="mx-3 mb-2 flex max-h-[30dvh] shrink-0 flex-col gap-1.5 overflow-y-auto rounded-2xl border border-white/6 bg-surface px-3.5 py-2.5 md:mx-7 md:mt-3"
    >
      {state.players.map((p, s) => (
        <div key={s} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="w-16 shrink-0 truncate text-xs font-semibold text-ink-soft">
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
      <span className="text-[10px] tracking-[0.06em] text-faint uppercase">{title}</span>
      {cards.length === 0 ? (
        <span className="text-xs text-faint">none</span>
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
