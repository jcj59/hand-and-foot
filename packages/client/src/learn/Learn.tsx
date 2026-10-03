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
import { narrate } from "./narrate";

/** How long the computer player takes over each move in a lesson. */
export const TUTOR_MOVE_MS = 900;

export function LessonList(): React.ReactElement {
  const done = loadProgress();
  const navigate = useNavigate();
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Learn to play</h1>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded border border-white/25 px-3 py-1 text-sm"
        >
          Main menu
        </button>
      </header>
      <p className="text-sm text-white/70">
        Short lessons, one idea each, played at the table against a computer player.
      </p>
      <ol className="flex flex-col gap-2">
        {LESSONS.map((lesson, i) => (
          <li key={lesson.id}>
            <Link
              to={`/learn/${lesson.id}`}
              className="flex items-center justify-between gap-3 rounded border border-white/15 bg-black/20 px-3 py-2"
            >
              <span>
                {i + 1}. {lesson.title}
              </span>
              {done.has(lesson.id) && (
                <span aria-label="done" className="text-sm text-emerald-300">
                  ✓
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
      <Link to="/learn/demo" className="text-sm text-sky-200 underline">
        Watch a demo game, with each move explained
      </Link>
    </main>
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
      nextRound: () => undefined,
      removePlayer: () => undefined,
    }),
    [lesson, navigate],
  );

  const step = lesson.steps[run.step];
  // One update per position, as the server sends one per move: the table keeps its
  // selection until the position changes.
  const update = useMemo(() => updateFor(lesson, run), [lesson, run]);
  return (
    <div className="relative flex h-full flex-col">
      <TableView
        update={update}
        room={update.room}
        result={null}
        notice={null}
        controls={controls}
        onMainMenu={() => navigate("/learn")}
        heading={`Lesson ${index + 1}: ${lesson.title}`}
      />
      <aside
        aria-label="Coach"
        className="fixed right-4 bottom-4 z-30 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 rounded-lg border border-sky-300/60 bg-felt-900/95 p-4 shadow-2xl"
      >
        {run.step === 0 && run.seq === 0 && <p className="text-sm text-white/80">{lesson.intro}</p>}
        {over ? (
          <>
            <p role="status" className="font-semibold text-emerald-200">
              Lesson done. {lesson.outro}
            </p>
            <div className="flex flex-wrap gap-2">
              {nextLesson ? (
                <button
                  type="button"
                  onClick={() => navigate(`/learn/${nextLesson.id}`)}
                  className="rounded bg-sky-300 px-3 py-1.5 text-sm font-medium text-black"
                >
                  Next: {nextLesson.title}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="rounded bg-sky-300 px-3 py-1.5 text-sm font-medium text-black"
                >
                  Play a real game
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate("/learn")}
                className="rounded border border-white/25 px-3 py-1.5 text-sm"
              >
                All lessons
              </button>
            </div>
          </>
        ) : run.state.currentSeat !== LEARNER ? (
          <p className="text-sm text-white/70">Robo Rita is taking her turn&hellip;</p>
        ) : (
          <>
            <p className="text-xs text-white/50">
              Step {run.step + 1} of {lesson.steps.length}
            </p>
            <p className="text-sm font-medium text-sky-100">{step!.ask}</p>
            {run.feedback && (
              <p role="alert" className="text-sm text-amber-200">
                {run.feedback}
              </p>
            )}
          </>
        )}
      </aside>
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
        title="A demo round"
        autoplay
        narrate={(step) => narrate(timeline, step)}
        onMainMenu={() => navigate("/learn")}
      />
    </div>
  );
}
