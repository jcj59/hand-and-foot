/**
 * A bug report's game, on the real table: paste (or open) the replay file
 * `pnpm reports:pull --replay <id>` writes, and the viewer plays it from the
 * deal, every hand visible on request, so a developer can watch exactly what
 * the reporting player's table did. Development only, like the rest of the
 * viewer; nothing here reaches a server.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildTimeline, type GameLog, type Timeline } from "@hf/engine";
import { Player } from "../playback/Player";

/** The pasted text as a timeline, or what is wrong with it. */
export function replayTimeline(
  text: string,
): { ok: true; timeline: Timeline } | { ok: false; error: string } {
  let log: GameLog;
  try {
    log = JSON.parse(text) as GameLog;
  } catch {
    return { ok: false, error: "that is not JSON" };
  }
  if (typeof log !== "object" || log === null || !Array.isArray(log.actions) || !log.setup) {
    return { ok: false, error: "that is not a replay file: it needs config, setup and actions" };
  }
  try {
    return { ok: true, timeline: buildTimeline(log) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function ReportReplay(): React.ReactElement {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (source: string): void => {
    const result = replayTimeline(source);
    if (result.ok) {
      setLoaded(result.timeline);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  if (loaded) {
    return (
      <div className="min-h-0 flex-1">
        <Player
          timeline={loaded}
          title="Bug report replay"
          start={{ step: loaded.length - 1, seat: 0 }}
          onMainMenu={() => setLoaded(null)}
        />
      </div>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 overflow-y-auto p-4">
      <Link to="/scenarios" className="text-sm text-sky-200 underline">
        ← Scenarios
      </Link>
      <h1 className="text-2xl font-semibold">Replay a bug report</h1>
      <p className="text-sm text-white/70">
        Paste the file from <code>pnpm reports:pull --replay &lt;id&gt;</code>, or open it. It opens
        at the last move, where the report was sent.
      </p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label="Open a replay file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void file.text().then(load);
        }}
      />
      <textarea
        aria-label="Replay file"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={10}
        className="rounded bg-black/30 p-2 font-mono text-xs"
      />
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <p className="flex gap-2">
        <button
          type="button"
          onClick={() => load(text)}
          className="rounded bg-amber-300 px-3 py-1.5 text-sm font-medium text-black"
        >
          Play it
        </button>
        <button
          type="button"
          onClick={() => navigate("/scenarios")}
          className="rounded border border-white/25 px-3 py-1.5 text-sm"
        >
          Back
        </button>
      </p>
    </main>
  );
}
