/**
 * The scenario viewer: a development tool for watching any situation in the game
 * play itself out on the real table, with no server and nobody playing.
 *
 * Mounted instead of the app, not inside it, so it opens no connection and shows
 * no connection banner; and only in builds that carry it (see `main.tsx`).
 * The player it drives is the reusable one in `playback/` — everything here is
 * about scenarios: the list, links into them, and running them all.
 */
import { useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { SCENARIOS, scenarioById, type Scenario } from "@hf/scenarios";
import { Player } from "../playback/Player";
import type { Speed } from "../playback/playback";
import { playlist, timelineOf } from "./catalog";
import { formatLink, parseLink, stepFor } from "./link";

export default function ScenarioApp(): React.ReactElement {
  return (
    <div className="flex h-dvh flex-col bg-felt-900 text-white">
      <Routes>
        <Route path="/scenarios" element={<ScenarioList />} />
        <Route path="/scenarios/all" element={<RunAll />} />
        <Route path="/scenarios/:id" element={<ScenarioPage />} />
        <Route path="*" element={<Navigate to="/scenarios" replace />} />
      </Routes>
    </div>
  );
}

export function ScenarioList(): React.ReactElement {
  return (
    <main className="mx-auto w-full max-w-3xl overflow-y-auto p-4">
      <h1 className="text-2xl font-semibold">Scenarios</h1>
      <p className="mt-1 text-sm text-white/70">
        Situations from the game, played on the real table from the engine, with no server. A
        development tool: the list lives in <code>@hf/scenarios</code>.
      </p>
      <p className="mt-3 flex flex-wrap gap-2">
        <Link
          to="/scenarios/all"
          className="rounded bg-amber-300 px-3 py-1.5 text-sm font-medium text-black"
        >
          Run all
        </Link>
        <Link
          to="/scenarios/all?moments=1"
          className="rounded border border-amber-300/60 px-3 py-1.5 text-sm text-amber-100"
        >
          Run all, around each moment only
        </Link>
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {SCENARIOS.map((s) => {
          const timeline = timelineOf(s);
          const named = timeline.moments.filter((m) => m.kind === "named");
          return (
            <li key={s.id} className="rounded-lg bg-black/20 p-3 ring-1 ring-white/10">
              <Link to={`/scenarios/${s.id}`} className="font-medium text-amber-200 underline">
                {s.title}
              </Link>
              <span className="ml-2 text-xs text-white/50">{timeline.length} steps</span>
              <p className="mt-1 text-sm text-white/75">{s.description}</p>
              {named.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {named.map((m) => (
                    <Link
                      key={m.id}
                      to={`/scenarios/${s.id}#moment=${m.id}`}
                      className="text-sky-200 underline"
                    >
                      ★ {m.label}
                    </Link>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function ScenarioPage(): React.ReactElement {
  const { id = "" } = useParams();
  const scenario = scenarioById(id);
  const { hash } = useLocation();
  const navigate = useNavigate();
  if (!scenario) return <Navigate to="/scenarios" replace />;
  const timeline = timelineOf(scenario);
  const link = parseLink(hash);
  const watch = scenario.watch ?? 0;
  return (
    <>
      <ScenarioHeader scenario={scenario} />
      <div className="min-h-0 flex-1">
        <Player
          // A new scenario, or a link followed to a new point, starts the player afresh.
          key={`${scenario.id}${hash}`}
          timeline={timeline}
          title={scenario.title}
          start={{
            step: stepFor(timeline, link),
            seat: link.seat ?? watch,
            revealAll: link.revealAll ?? false,
          }}
          // Opened at the beginning, it plays; a link to a point stops there to look.
          autoplay={stepFor(timeline, link) === undefined}
          onPositionChange={(position) => {
            const next = formatLink(timeline, position, watch);
            // Replaced in place, not navigated: the address bar follows the player,
            // and following a link elsewhere still starts afresh.
            if (next !== window.location.hash) {
              window.history.replaceState(window.history.state, "", next);
            }
          }}
          onMainMenu={() => navigate("/scenarios")}
        />
      </div>
    </>
  );
}

function ScenarioHeader({
  scenario,
  children,
}: {
  readonly scenario: Scenario;
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-white/10 px-3 py-1.5">
      <Link to="/scenarios" className="text-sm text-sky-200 underline">
        ← Scenarios
      </Link>
      <h1 className="font-semibold">{scenario.title}</h1>
      <p
        className="min-w-0 flex-1 basis-64 truncate text-xs text-white/70"
        title={scenario.description}
      >
        {scenario.description}
      </p>
      {children}
    </header>
  );
}

/**
 * Every scenario in turn, unattended — or only the few steps around each named
 * moment — starting over at the end, so it can be left running on a screen.
 */
function RunAll(): React.ReactElement {
  const { search } = useLocation();
  const navigate = useNavigate();
  const momentsOnly = new URLSearchParams(search).get("moments") === "1";
  const items = useMemo(() => playlist(momentsOnly), [momentsOnly]);
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState<Speed>(momentsOnly ? 1 : 2);
  const item = items[index % items.length]!;
  const next = (): void => setIndex((i) => (i + 1) % items.length);
  return (
    <>
      <ScenarioHeader scenario={item.scenario}>
        <span className="text-xs text-white/60">
          {index + 1} of {items.length}
        </span>
        <button
          type="button"
          onClick={next}
          className="rounded border border-white/25 px-2 py-0.5 text-xs"
        >
          Skip
        </button>
      </ScenarioHeader>
      <div className="min-h-0 flex-1">
        <Player
          key={index}
          timeline={timelineOf(item.scenario)}
          title={item.scenario.title}
          start={{ seat: item.scenario.watch ?? 0 }}
          range={{ from: item.from, to: item.to }}
          autoplay
          speed={speed}
          onSpeedChange={setSpeed}
          onEnd={next}
          onMainMenu={() => navigate("/scenarios")}
        />
      </div>
    </>
  );
}
