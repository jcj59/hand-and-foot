/**
 * The player's games: their stats, and the matches they played lately.
 *
 * Asked of the server for this browser's identity, if it has one — a browser that
 * has never sat down has no games to show, and one is not made just to ask. Shown
 * only once there is something in it, so a new player's home screen is not a
 * table of zeros. A server that cannot be reached shows nothing rather than an
 * error: the history is a pleasure, never something a player needs to get to a
 * table.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MATCHES_PATH, type MatchHistory as History, type MatchListing } from "@hf/shared";
import { loadIdentity, type Post } from "../identity";

export interface MatchHistoryProps {
  readonly post: Post;
}

export function MatchHistory({ post }: MatchHistoryProps): React.ReactElement | null {
  const [history, setHistory] = useState<History | null>(null);

  useEffect(() => {
    const user = loadIdentity();
    if (!user) return;
    let live = true;
    post(MATCHES_PATH, { user })
      .then((answer) => {
        if (live && answer.ok) setHistory(answer.data as History);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [post]);

  if (!history || history.recent.length === 0) return null;
  const { stats, recent } = history;
  const tiles: [string, string][] = [
    ["Games", String(stats.played)],
    ["Wins", String(stats.wins)],
    ["Average score", stats.averageScore === null ? "–" : String(stats.averageScore)],
    ["Best round", stats.bestRound === null ? "–" : String(stats.bestRound)],
    ["Went out", String(stats.wentOut)],
    ["Clean books", String(stats.cleanBooks)],
    ["Grabby Pants", String(stats.grabbyPants)],
    ["Marva Rules", String(stats.marvaRules)],
  ];

  return (
    <section aria-label="Your games" className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-white/80">Your games</h2>
      <dl className="grid grid-cols-4 gap-2">
        {tiles.map(([label, value]) => (
          <div key={label} className="flex flex-col rounded bg-black/20 px-2 py-1.5">
            <dt className="text-[0.65rem] leading-tight text-white/55">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {stats.unfinished > 0 && (
        <p className="text-xs text-white/50">
          And {stats.unfinished} unfinished game{stats.unfinished === 1 ? "" : "s"}, counted for
          rounds but not wins.
        </p>
      )}
      <ul aria-label="Recent games" className="flex flex-col gap-2">
        {recent.map((match) => (
          <li
            key={match.id}
            className="rounded border border-white/10 bg-black/15 px-3 py-2 text-sm"
          >
            <p className="flex items-baseline justify-between gap-2">
              <span className={match.won ? "font-semibold text-amber-200" : "font-medium"}>
                {outcome(match)}
              </span>
              <span className="text-xs text-white/50">{formatDate(match.endedAt)}</span>
            </p>
            <p className="mt-0.5 text-xs text-white/60">
              {[...match.players]
                .sort((a, b) => b.total - a.total)
                .map(
                  (p) =>
                    `${p.name}${p.bot ? " (computer)" : ""}${p.left ? " (left)" : ""} ${p.total}`,
                )
                .join(" · ")}
            </p>
            <Link
              to={`/replay/${match.id}`}
              aria-label={`Watch the game at table ${match.roomId} again`}
              className="mt-1 inline-block text-xs text-sky-200 underline"
            >
              Watch again
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How the match went for the player, in a few words. */
export function outcome(match: MatchListing): string {
  const mine = match.players.find((p) => p.seat === match.seat)!;
  if (mine.left) return `Left · ${mine.total}`;
  if (!match.finished) {
    return `Unfinished · ${match.roundsPlayed} of ${match.rounds} round${match.rounds === 1 ? "" : "s"}`;
  }
  if (match.won) return `Won · ${mine.total}`;
  const finishers = match.players.filter((p) => !p.left).length;
  return `${ordinal(match.place!)} of ${finishers} · ${mine.total}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}
