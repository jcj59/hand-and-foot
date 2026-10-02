/**
 * Watching one of the player's own past matches again, on the real table.
 *
 * Everything about playback is the shared player's, built for this from the start:
 * the match only has to be loaded and turned into the player's input — the rules,
 * the seed and first seat it was dealt from, and the moves in order. The match is
 * over, so the player may watch any seat or every hand at once; it opens on their
 * own seat. A point in it can be linked to, as a scenario's can (`#step=12&seat=1`).
 *
 * Only a match the player was in can be opened, on a browser holding their
 * identity: the server checks both, and an id on its own opens nothing.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { MATCH_PATH, type ReplayMatch } from "@hf/shared";
import { buildTimeline, type Timeline } from "@hf/engine";
import { httpPost, loadIdentity, type Post } from "../identity";
import { formatLink, parseLink, stepFor } from "../playback/link";
import { Player } from "../playback/Player";
import { serverUrl } from "../socket";

export interface ReplayProps {
  /** How the match is asked for; the page's own origin unless a test answers it. */
  readonly post?: Post;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "ready"; readonly match: ReplayMatch };

/** Shown when this browser has no identity to ask with. */
export const NO_PROFILE =
  "Games can be watched again on the device you played them on, or one you moved your profile to.";

/** Shown when the server could not be asked. */
export const UNREACHABLE = "Could not reach the server to load that game. Try again later.";

/** Shown when the record no longer replays, as after a change to the rules. */
export const UNPLAYABLE =
  "That game can no longer be played back: the rules have changed since it was recorded.";

/** A recorded match as the player's input: how it was dealt, what was played, and who played it. */
export function timelineOf(match: ReplayMatch): Timeline {
  return buildTimeline({
    config: match.config,
    setup: { seed: match.seed, playerCount: match.seats.length, firstSeat: match.firstSeat },
    actions: match.log.map((move) => move.action),
    names: match.seats.map((s) => (s.bot ? `${s.name} (computer)` : s.name)),
  });
}

export function Replay({ post = httpPost(serverUrl()) }: ReplayProps): React.ReactElement {
  const { matchId = "" } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    const user = loadIdentity();
    if (!user) {
      setLoaded({ state: "failed", message: NO_PROFILE });
      return;
    }
    let live = true;
    post(MATCH_PATH, { user, id: matchId })
      .then((answer) => {
        if (!live) return;
        if (answer.ok) setLoaded({ state: "ready", match: answer.data as ReplayMatch });
        else setLoaded({ state: "failed", message: capitalize(answer.error) + "." });
      })
      .catch(() => {
        if (live) setLoaded({ state: "failed", message: UNREACHABLE });
      });
    return () => {
      live = false;
    };
  }, [post, matchId]);

  const timeline = useMemo(() => {
    if (loaded.state !== "ready") return null;
    try {
      return timelineOf(loaded.match);
    } catch {
      return "unplayable" as const;
    }
  }, [loaded]);

  if (loaded.state === "loading") {
    return <main className="p-6 text-white/60">Loading the game&hellip;</main>;
  }
  if (loaded.state === "failed" || !timeline || timeline === "unplayable") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Watch a game again</h1>
        <p role="alert" className="rounded bg-red-600/20 px-3 py-2 text-sm text-red-200">
          {loaded.state === "failed" ? loaded.message : UNPLAYABLE}
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="self-start rounded bg-white px-4 py-2 font-medium text-felt-900"
        >
          Back to the main screen
        </button>
      </main>
    );
  }
  const { match } = loaded;
  const link = parseLink(hash);
  const step = stepFor(timeline, link);
  return (
    // The player fills the window, as the table does.
    <div className="flex h-full flex-col">
      <Player
        timeline={timeline}
        title={`Table ${match.roomId} · ${new Date(match.endedAt).toLocaleDateString([], {
          month: "short",
          day: "numeric",
        })}`}
        start={{ step, seat: link.seat ?? match.seat, revealAll: link.revealAll ?? false }}
        // From the start it plays; a link to a point stops there to look.
        autoplay={step === undefined}
        onPositionChange={(position) => {
          const next = formatLink(timeline, position, match.seat);
          if (next !== window.location.hash) {
            window.history.replaceState(window.history.state, "", next);
          }
        }}
        onMainMenu={() => navigate("/")}
      />
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
