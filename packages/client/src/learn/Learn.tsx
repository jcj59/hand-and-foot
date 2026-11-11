/**
 * Learning to play: the lessons, a lesson at the real table, and a demo game.
 *
 * A lesson is played at the table a real game uses, from a local engine with no
 * server: the learner's moves go through the same reducer, the computer player's
 * through the same heuristic, and the coach's panel says what to do next and why a
 * move was not the one asked for.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { EAST_COAST } from "@hf/shared";
import { applyAction, buildTimeline, deal, heuristicPolicy, type Timeline } from "@hf/engine";
import { LEARNER, LESSONS, lessonById, type Lesson } from "@hf/scenarios";
import { Player } from "../playback/Player";
import { TableView, type TableControls } from "../table/TableView";
import {
  computerMove,
  finished,
  learnerMove,
  startRun,
  updateFor,
  type LessonRun,
} from "./lessonRun";
import { loadProgress, markDone } from "./progress";
import { courseOf, lookOf } from "./lessonMeta";
import { usePhone } from "../usePhone";
import { Button, buttonClass } from "../ui/Button";
import { IconBox } from "../ui/IconBox";
import { Icon, ICONS } from "../ui/icons";
import { narrate } from "./narrate";

/** How long the computer player takes over each move in a lesson. */
export const TUTOR_MOVE_MS = 900;

export function LessonList(): React.ReactElement {
  const phone = usePhone();
  const navigate = useNavigate();
  const course = courseOf(LESSONS, loadProgress());
  const next = course.next;
  const index = next ? LESSONS.indexOf(next) : LESSONS.length - 1;
  const progress = `${(course.done / LESSONS.length) * 100}%`;
  const bar = (
    <div aria-hidden="true" className="h-1.5 max-w-[360px] rounded-[3px] bg-black/30">
      <div className="h-full rounded-[3px] bg-accent" style={{ width: progress }} />
    </div>
  );
  const counts = next
    ? [`Lesson ${index + 1} of ${LESSONS.length}`, `${course.done} done`]
    : [`${LESSONS.length} of ${LESSONS.length}`, "All done"];
  const start = (
    <Link
      to={next ? `/learn/${next.id}` : "/practice"}
      className={buttonClass("primary", phone ? "md" : "lg", phone ? "self-start" : "")}
    >
      <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
        <path d={ICONS.play} />
      </svg>
      {next ? (course.done > 0 ? "Continue" : "Start") : "Practice"}
    </Link>
  );
  const upNext = (
    <section
      aria-label="Up next"
      className={`flex rounded-[22px] md:rounded-3xl ${
        phone ? "flex-col gap-3 p-[18px]" : "flex-wrap items-end gap-6 p-7"
      }`}
      style={{ background: HERO }}
    >
      <div className={`flex min-w-0 flex-col ${phone ? "gap-3" : "flex-[1_1_320px] gap-2.5"}`}>
        {phone ? (
          <>
            <p className="m-0 flex justify-between text-[13px] text-ink/80">
              <span>{counts[0]}</span>
              <span>{counts[1]}</span>
            </p>
            {bar}
          </>
        ) : (
          <p className="m-0 text-sm text-ink/80">{counts.join(" · ")}</p>
        )}
        <h2
          className={`m-0 font-display font-bold tracking-[-0.02em] ${
            phone ? "mt-1 text-2xl" : "text-[34px]"
          }`}
        >
          {next ? next.title : "Every lesson done"}
        </h2>
        <p className={`m-0 text-ink/80 ${phone ? "text-sm" : "max-w-[32rem] text-base"}`}>
          {!next
            ? "Try a real game against the computers, or go over any lesson again."
            : phone
              ? lookOf(next).blurb
              : "Short lessons, one idea each, played at the real table against a computer player. A coach says what to do next and why."}
        </p>
        {!phone && bar}
      </div>
      {start}
    </section>
  );
  const status = (lesson: Lesson, i: number): React.ReactElement => {
    const state = course.status(lesson);
    return (
      <span
        aria-label={state === "done" ? "done" : state === "next" ? "up next" : undefined}
        className={`flex shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold ${
          phone ? "h-7 w-7" : "h-[30px] w-[30px]"
        } ${
          state === "done"
            ? "bg-accent text-accent-ink"
            : state === "next"
              ? "border-2 border-accent text-accent"
              : "bg-raised text-muted"
        }`}
      >
        {state === "done" ? <Icon name="check" size={14} /> : i + 1}
      </span>
    );
  };
  return (
    <main
      className={`mx-auto flex w-full flex-col ${
        phone ? "max-w-md gap-[18px] px-5 pt-5 pb-6" : "max-w-[1100px] gap-[26px] px-10 pt-8 pb-12"
      }`}
    >
      <header className="flex items-center gap-3">
        {phone && (
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate("/")}
            className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-white/8 bg-surface"
          >
            <Icon name="back" size={18} />
          </button>
        )}
        <h1
          className={`m-0 font-display font-bold tracking-[-0.02em] ${
            phone ? "text-2xl" : "text-[32px]"
          }`}
        >
          Learn to play
        </h1>
      </header>
      {upNext}
      <ol
        aria-label="Lessons"
        className={
          phone
            ? "m-0 list-none overflow-hidden rounded-[18px] border border-white/6 bg-surface p-0"
            : "m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-0"
        }
      >
        {LESSONS.map((lesson, i) => {
          const look = lookOf(lesson);
          const state = course.status(lesson);
          return (
            <li key={lesson.id}>
              {phone ? (
                <Link
                  to={`/learn/${lesson.id}`}
                  className={`flex min-h-[52px] items-center gap-3 px-3.5 py-2 ${
                    i > 0 ? "border-t border-white/5" : ""
                  } ${state === "next" ? "bg-accent/6" : "hover:bg-white/3"}`}
                >
                  <IconBox icon={look.icon} color={look.color} size={36} />
                  <span className="flex-1 text-[15px] font-medium">{lesson.title}</span>
                  {status(lesson, i)}
                </Link>
              ) : (
                <Link
                  to={`/learn/${lesson.id}`}
                  className={`flex h-full min-h-[120px] flex-col justify-between gap-2 rounded-[18px] border bg-surface p-4 hover:bg-raised ${
                    state === "next" ? "border-accent" : "border-white/6"
                  }`}
                >
                  <span className="flex items-start justify-between">
                    <IconBox icon={look.icon} color={look.color} size={44} />
                    {status(lesson, i)}
                  </span>
                  <span className="font-display text-base font-semibold">{lesson.title}</span>
                  <span className="text-xs text-muted">
                    {state === "done" ? "Done" : state === "next" ? "Up next" : "Not started"}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <div
        className={phone ? "mt-auto" : "grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3"}
      >
        <Tile
          to="/learn/demo"
          icon={<PlayGlyph />}
          color="violet"
          title="Watch a demo game"
          detail="Sit back, every move explained"
          big={!phone}
        />
        {!phone && (
          <Tile
            to="/practice"
            icon={<Icon name="bot" size={20} />}
            color="blue"
            title="Practice vs computers"
            detail="A real game, at your own pace"
            big
          />
        )}
      </div>
    </main>
  );
}

/** The "Up next" card's lit felt green, as the design paints it. */
const HERO = "radial-gradient(120% 130% at 90% 0%, #2F7A5C, #164433 60%, #0F2D22)";

function PlayGlyph(): React.ReactElement {
  return (
    <svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
      <path d={ICONS.play} />
    </svg>
  );
}

const TILE_COLORS = { violet: "bg-violet/18 text-violet", blue: "bg-blue/18 text-blue" } as const;

function Tile({
  to,
  icon,
  color,
  title,
  detail,
  big,
}: {
  readonly to: string;
  readonly icon: React.ReactNode;
  readonly color: keyof typeof TILE_COLORS;
  readonly title: string;
  readonly detail: string;
  readonly big: boolean;
}): React.ReactElement {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3.5 border border-white/8 bg-surface hover:bg-raised ${
        big ? "rounded-[18px] p-[18px]" : "rounded-2xl p-3.5"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center ${TILE_COLORS[color]} ${
          big ? "h-12 w-12 rounded-[14px]" : "h-11 w-11 rounded-xl"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold ${big ? "text-base" : "text-[15px]"}`}>{title}</span>
        <span className={`block text-muted ${big ? "text-[13px]" : "text-xs"}`}>{detail}</span>
      </span>
    </Link>
  );
}

export function LessonPage(): React.ReactElement {
  const { lessonId = "" } = useParams();
  if (lessonId === "demo") return <DemoGame />;
  const lesson = lessonById(lessonId);
  if (!lesson) return <Navigate to="/learn" replace />;
  // A new lesson starts afresh.
  return <LessonTable key={lesson.id} lesson={lesson} />;
}

function LessonTable({ lesson }: { readonly lesson: Lesson }): React.ReactElement {
  const navigate = useNavigate();
  const phone = usePhone();
  const [run, setRun] = useState<LessonRun>(() => startRun(lesson));
  // The run as of the last move, read by the controls, which answer at once whether
  // the move was played.
  const latest = useRef(run);
  latest.current = run;
  const over = finished(lesson, run);
  const index = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[index + 1];

  // The computer player takes its turns at a person's pace.
  useEffect(() => {
    if (run.state.roundEnded || run.state.currentSeat === LEARNER) return;
    const timer = setTimeout(() => setRun((current) => computerMove(current)), TUTOR_MOVE_MS);
    return () => clearTimeout(timer);
  }, [run]);

  useEffect(() => {
    if (over) markDone(lesson.id);
  }, [over, lesson.id]);

  const controls: TableControls = useMemo(
    () => ({
      play: async (action) => {
        const current = latest.current;
        const next = learnerMove(lesson, current, action);
        latest.current = next;
        setRun(next);
        return next.seq !== current.seq;
      },
      stageDraft: () => undefined,
      pause: async () => undefined,
      saveForLater: async () => undefined,
      react: () => undefined,
      leave: () => navigate("/learn"),
      playAgain: () => undefined,
      rematch: () => undefined,
      nextRound: () => undefined,
      removePlayer: () => undefined,
    }),
    [lesson, navigate],
  );

  const step = lesson.steps[run.step];
  // One update per position, as the server sends one per move: the table keeps its
  // selection until the position changes.
  const update = useMemo(() => updateFor(lesson, run), [lesson, run]);
  const coach = (
    <aside
      aria-label="Coach"
      // Drawn as the demo's narration card: the coach is the same voice, talking
      // to the learner.
      className={`flex flex-col gap-2 rounded-2xl border border-white/8 bg-surface text-ink ${
        phone ? "mx-3 mb-1 shrink-0 px-3.5 py-3" : "mb-4 px-4 py-3.5"
      }`}
    >
      <p className="m-0 text-xs font-semibold text-accent">Coach</p>
      {run.step === 0 && run.seq === 0 && (
        <p className="m-0 text-[13px] leading-[1.45] text-[#D5DADF]">{lesson.intro}</p>
      )}
      {over ? (
        <>
          <p role="status" className="m-0 text-sm leading-[1.45] font-semibold text-[#C9F5DF]">
            Lesson done. {lesson.outro}
          </p>
          <div className="flex flex-wrap gap-2">
            {nextLesson ? (
              <Button onClick={() => navigate(`/learn/${nextLesson.id}`)}>
                Next: {nextLesson.title}
              </Button>
            ) : (
              <Button onClick={() => navigate("/")}>Play a real game</Button>
            )}
            <Button variant="secondary" onClick={() => navigate("/learn")}>
              All lessons
            </Button>
          </div>
        </>
      ) : run.state.currentSeat !== LEARNER ? (
        <p className="m-0 text-sm text-muted">Robo Rita is taking her turn&hellip;</p>
      ) : (
        <>
          <p className="m-0 text-xs text-muted">
            Step {run.step + 1} of {lesson.steps.length}
          </p>
          <p className="m-0 text-sm leading-[1.45] font-medium">{step!.ask}</p>
          {run.feedback && (
            <p
              role="alert"
              className="m-0 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-[13px] text-gold-soft"
            >
              {run.feedback}
            </p>
          )}
        </>
      )}
    </aside>
  );
  return (
    // On a computer the coach has the side panel, above the scores; on a phone,
    // where the table has no space to spare, its own space above the table.
    <div className="flex h-full flex-col bg-page">
      <div className="min-h-0 flex-1">
        <TableView
          update={update}
          room={update.room}
          result={null}
          notice={null}
          controls={controls}
          onMainMenu={() => navigate("/learn")}
          heading={`Lesson ${index + 1}: ${lesson.title}`}
          belowHeader={phone && coach}
          aside={(scores) => (
            <>
              {coach}
              {scores}
            </>
          )}
        />
      </div>
    </div>
  );
}

/** A round of computer players, to watch with each move put into words. */
export function demoTimeline(seed = 4): Timeline {
  let state = deal(3, EAST_COAST, seed);
  const actions = [];
  for (let guard = 0; !state.roundEnded && guard < 5_000; guard++) {
    const action = heuristicPolicy(state, state.currentSeat)!;
    actions.push(action);
    const r = applyAction(state, action);
    /* v8 ignore next -- the heuristic only ever offers moves the reducer accepts */
    if (!r.ok) break;
    state = r.state;
  }
  return buildTimeline({
    config: EAST_COAST,
    setup: { seed, playerCount: 3 },
    actions,
    names: ["Robo Rita", "Robo Ray", "Robo Rosa"],
  });
}

function DemoGame(): React.ReactElement {
  const navigate = useNavigate();
  const timeline = useMemo(() => demoTimeline(), []);
  return (
    <div className="flex h-full flex-col">
      <Player
        timeline={timeline}
        title="Demo game"
        autoplay
        narrate={(step) => narrate(timeline, step)}
        onMainMenu={() => navigate("/learn")}
        backLabel="Learn"
        tools={false}
      />
    </div>
  );
}
