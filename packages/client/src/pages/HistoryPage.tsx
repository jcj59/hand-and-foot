/**
 * Your past games: the stats, the fun counts, and every recent game as a card
 * colored by how it went, with filters by place, when and who else was there.
 *
 * The history is asked of the server once, for this browser's identity, and the
 * filters run over what came back. A browser that has never sat down has no games
 * and is not given an identity just to ask; a server that cannot be reached shows
 * the page with nothing on it rather than an error.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MatchHistory as History, MatchListing } from "@hf/shared";
import { resumeSavedGame } from "../actions";
import { LEVEL_COLOR } from "../home/sheets";
import {
  awardsOf,
  badgeOf,
  metaOf,
  points,
  resultOf,
  scoreRows,
  titleOf,
  type Result,
  type ScoreRow,
} from "../history/describe";
import {
  NO_FILTERS,
  PLACES,
  SORTS,
  WHENS,
  companions,
  filterGames,
  summary,
  toggled,
  type Companion,
  type Filters,
  type SortOrder,
  type WhenFilter,
} from "../history/filters";
import { loadIdentity, serverPost, type Post } from "../identity";
import { loadHistory } from "../historyCache";
import { AvatarFace, BACKGROUND_COLORS } from "../profile/Avatar";
import { faceOf } from "../profile/avatarStore";
import { loadSavedGames, type SavedGame } from "../savedGames";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { PlayerFace } from "../table/PlayerFace";
import { PageHeader } from "../ui/PageHeader";
import { usePhone } from "../usePhone";

export interface HistoryPageProps {
  readonly socket: HfClientSocket;
  readonly post?: Post;
}

/** How many people the "Played with" filter offers, most played with first. */
const COMPANIONS_SHOWN = 6;

/** Each result's card: its gradient, the glow in its corner, and its badge. */
const THEMES: Record<Result, { card: string; glow: string; badge: string }> = {
  won: {
    card: "linear-gradient(150deg, #23895F 0%, #17603F 45%, #10342A 100%)",
    glow: "rgba(242,193,78,0.35)",
    badge: "bg-gold text-[#3A2A00]",
  },
  second: {
    card: "linear-gradient(150deg, #4057B0 0%, #2A3A7A 50%, #182042 100%)",
    glow: "rgba(143,184,232,0.35)",
    badge: "bg-[#C9D8F5] text-[#1A2550]",
  },
  third: {
    card: "linear-gradient(150deg, #7A47B5 0%, #4C2C7C 50%, #24163C 100%)",
    glow: "rgba(214,166,240,0.35)",
    badge: "bg-[#E7CCF6] text-[#36114A]",
  },
  unfinished: {
    card: "linear-gradient(150deg, #A0662A 0%, #6A4419 50%, #2E1F0E 100%)",
    glow: "rgba(255,200,120,0.3)",
    badge: "bg-[#FFD9A3] text-[#4A2C08]",
  },
};

export function HistoryPage({ socket, post = serverPost() }: HistoryPageProps) {
  const phone = usePhone();
  const history = useHistory(post);
  const notice = useSession((s) => s.notice);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-3.5 px-5 py-5 md:gap-6 md:px-10 md:py-8">
      <PageHeader title="History" />
      {notice && (
        <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">
          {notice}
        </p>
      )}
      {history === "none" || (history && history.recent.length === 0) ? (
        <p className="rounded-[18px] bg-surface p-7 text-center text-muted">No games yet.</p>
      ) : (
        history && <Games history={history} phone={phone} socket={socket} />
      )}
    </main>
  );
}

/**
 * The player's history: null while it is being asked for (or if it never comes),
 * "none" for a browser with no identity, which has no games to ask about.
 */
function useHistory(post: Post): History | "none" | null {
  const [user] = useState(loadIdentity);
  const [history, setHistory] = useState<History | null>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    loadHistory(post, user)
      .then((answer) => {
        if (live && answer.ok) setHistory(answer.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [post, user]);
  return user ? history : "none";
}

function Games({
  history,
  phone,
  socket,
}: {
  readonly history: History;
  readonly phone: boolean;
  readonly socket: HfClientSocket;
}): React.ReactElement {
  const { stats, recent } = history;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const people = useMemo(() => companions(recent, COMPANIONS_SHOWN), [recent]);
  const shown = filterGames(recent, filters, Date.now());
  const resume = useResume(socket);

  const tiles: [string, string, string][] = [
    ["Games", "Games", points(stats.played)],
    ["Wins", "Wins", points(stats.wins)],
    ["Average score", "Avg score", stats.averageScore === null ? "–" : points(stats.averageScore)],
    ["Best round", "Best round", stats.bestRound === null ? "–" : points(stats.bestRound)],
  ];
  const fun: [number, string][] = [
    [stats.wentOut, "went out"],
    [stats.cleanBooks, "clean books"],
    [stats.grabbyPants, "Grabby Pants"],
    [stats.marvaRules, "Marva Rules"],
    [stats.pilesTaken, "piles taken"],
    [stats.redThreesEaten, "red threes eaten"],
  ];

  return (
    <>
      <section
        aria-label="Your stats"
        className={
          phone
            ? "grid grid-cols-4 gap-2"
            : "grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3"
        }
      >
        {tiles.map(([label, short, value]) => (
          <div
            key={label}
            className={`flex border border-white/6 bg-surface ${
              phone ? "flex-col-reverse rounded-[14px] p-2.5" : "flex-col rounded-2xl p-4"
            }`}
          >
            <p
              className={
                phone ? "mt-0.5 truncate text-[11px] text-muted" : "text-[13px] text-muted"
              }
            >
              {phone ? short : label}
            </p>
            <p
              className={`font-display font-bold ${phone ? "truncate text-xl" : "mt-1 text-[28px]"}`}
            >
              {value}
            </p>
          </div>
        ))}
      </section>

      <section
        aria-label="More stats"
        className={`flex gap-2 ${phone ? "no-scrollbar -mx-5 shrink-0 overflow-x-auto px-5" : "flex-wrap"}`}
      >
        {fun.map(([value, label]) => (
          <span
            key={label}
            className={`shrink-0 rounded-full bg-white/6 py-2 text-ink-soft ${
              phone ? "px-3 text-[13px]" : "px-3.5 text-sm"
            }`}
          >
            <span className="font-bold text-ink">{points(value)}</span> {label}
          </span>
        ))}
      </section>

      <section className="flex flex-col gap-3.5">
        <h2 className={phone ? "sr-only" : "font-display text-lg font-semibold"}>Recent games</h2>
        <FilterBar
          phone={phone}
          filters={filters}
          onChange={setFilters}
          people={people}
          count={shown.length}
        />
        {shown.length === 0 ? (
          <p className="rounded-[18px] bg-surface p-7 text-center text-muted">
            No games match these filters.
          </p>
        ) : (
          <ul
            aria-label="Recent games"
            className={
              phone
                ? "flex flex-col gap-3.5 pb-5"
                : "grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4"
            }
          >
            {shown.map((match) => (
              <GameCard key={match.id} match={match} phone={phone} resume={resume} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const FIELD =
  "rounded-[10px] border border-white/12 bg-raised px-2.5 text-[13px] font-medium text-ink";

function FilterBar({
  phone,
  filters,
  onChange,
  people,
  count,
}: {
  readonly phone: boolean;
  readonly filters: Filters;
  readonly onChange: (filters: Filters) => void;
  readonly people: readonly Companion[];
  readonly count: number;
}): React.ReactElement {
  const label = phone ? "text-[11px] text-quiet" : "text-xs text-quiet";
  const place = (
    <div
      role="group"
      aria-label="Place"
      className={`flex gap-1.5 ${phone ? "no-scrollbar overflow-x-auto" : "flex-wrap"}`}
    >
      {PLACES.map(({ value, label: text }) => {
        const on = filters.place === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange({ ...filters, place: value })}
            className={`min-h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold ${
              on ? "bg-accent text-accent-ink" : "bg-white/7 text-ink-soft hover:bg-white/12"
            }`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
  const withWho = people.length > 0 && (
    <div role="group" aria-label="Played with" className="flex items-center gap-2">
      {phone && <span className={`${label} mr-0.5`}>With</span>}
      {people.map((person) => {
        const on = filters.with.includes(person.name);
        return (
          <button
            key={person.name}
            type="button"
            aria-pressed={on}
            aria-label={`Played with ${person.name}`}
            title={person.name}
            onClick={() => onChange({ ...filters, with: toggled(filters.with, person.name) })}
            className={`shrink-0 rounded-full ${
              on ? "shadow-[0_0_0_2px_#14181C,0_0_0_4px_#4ADE9B]" : "opacity-45 hover:opacity-75"
            }`}
          >
            <AvatarFace avatar={faceOf(person)} size={36} />
          </button>
        );
      })}
    </div>
  );
  const when = (
    <label className="flex flex-col gap-1 md:gap-1.5">
      <span className={label}>When</span>
      <select
        value={filters.when}
        onChange={(e) => onChange({ ...filters, when: e.target.value as WhenFilter })}
        className={`${FIELD} ${phone ? "min-h-10" : "min-h-[38px]"}`}
      >
        {WHENS.map(({ value, label: text }) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const sort = (
    <label className="flex flex-col gap-1 md:gap-1.5">
      <span className={label}>Sort by</span>
      <select
        value={filters.sort}
        onChange={(e) => onChange({ ...filters, sort: e.target.value as SortOrder })}
        className={`${FIELD} ${phone ? "min-h-10" : "min-h-[38px]"}`}
      >
        {SORTS.map(({ value, label: text }) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const said = (
    <p role="status" className={phone ? "text-xs text-muted" : "ml-auto text-[13px] text-muted"}>
      {summary(count, filters.with)}
    </p>
  );

  return phone ? (
    <div
      role="group"
      aria-label="Filter games"
      className="flex shrink-0 flex-col gap-2.5 rounded-[18px] border border-white/6 bg-[#14181C] p-3"
    >
      {place}
      <div className="grid grid-cols-2 gap-2">
        {sort}
        {when}
      </div>
      {withWho}
      {said}
    </div>
  ) : (
    <div
      role="group"
      aria-label="Filter games"
      className="flex flex-wrap items-end gap-x-5 gap-y-3.5 rounded-[18px] border border-white/6 bg-[#14181C] px-4 py-3.5"
    >
      <div className="flex flex-col gap-1.5">
        <span className={label}>Place</span>
        {place}
      </div>
      {withWho && (
        <div className="flex flex-col gap-1.5">
          <span className={label}>Played with</span>
          {withWho}
        </div>
      )}
      {when}
      {sort}
      {said}
    </div>
  );
}

/**
 * Picking a saved game back up from its card, as Home's Resume does. Only a game
 * this device still holds a saved seat at can be resumed; anything else is over.
 */
function useResume(socket: HfClientSocket): {
  readonly saved: (roomId: string) => SavedGame | undefined;
  readonly start: (game: SavedGame) => void;
} {
  const navigate = useNavigate();
  const seat = useSession((s) => s.seat);
  const setNotice = useSession((s) => s.setNotice);
  const [saved, setSaved] = useState(liveSavedGames);
  const [busy, setBusy] = useState(false);
  return {
    saved: (roomId) => saved.find((g) => g.roomId === roomId),
    start: (game) => {
      if (busy) return;
      setBusy(true);
      void resumeSavedGame(socket, game, { seat, setNotice })
        .then((resumed) => {
          if (resumed) navigate(`/room/${game.roomId}`);
          // A game that turned out to be gone has been forgotten; stop offering it.
          else setSaved(liveSavedGames());
        })
        .finally(() => setBusy(false));
    },
  };
}

function liveSavedGames(): readonly SavedGame[] {
  return loadSavedGames().filter((g) => g.savedUntil > Date.now());
}

function GameCard({
  match,
  phone,
  resume,
}: {
  readonly match: MatchListing;
  readonly phone: boolean;
  readonly resume: ReturnType<typeof useResume>;
}): React.ReactElement {
  const result = resultOf(match);
  const theme = THEMES[result];
  const rows = scoreRows(match);
  const you = rows.find((r) => r.you)!;
  const awards = awardsOf(match);
  const saved = result === "unfinished" ? resume.saved(match.roomId) : undefined;
  const action =
    "flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-white/92 px-3.5 text-[13px] font-semibold text-[#11161A] hover:bg-white";

  return (
    <li
      className={`relative flex flex-col gap-4 overflow-hidden rounded-[22px] p-[18px] shadow-[0_18px_36px_-18px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] ${
        phone ? "" : "min-h-[272px]"
      }`}
      style={{ background: theme.card }}
    >
      <div
        aria-hidden="true"
        className="absolute -top-[70px] -right-[60px] size-[220px] rounded-full"
        style={{ background: `radial-gradient(closest-side, ${theme.glow}, transparent)` }}
      />
      <div className="relative flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-[46px] shrink-0 items-center justify-center rounded-[14px] font-display text-sm font-bold ${theme.badge}`}
        >
          {badgeOf(match)}
        </span>
        <span className="min-w-0 flex-1">
          <h3 className="font-display text-[19px] font-bold tracking-[-0.01em] md:text-xl">
            {titleOf(match)}
          </h3>
          <span className="block text-xs text-white/72">{metaOf(match)}</span>
        </span>
        <span className="text-right">
          <span className="block font-display text-xl font-bold md:text-[22px]">
            {points(you.player.total)}
          </span>
          <span className="block text-[11px] text-white/65">your score</span>
        </span>
      </div>

      <ol aria-label="Final scores" className="relative flex flex-col gap-2 md:gap-[9px]">
        {rows.map((row, i) => (
          <ScoreLine key={row.player.seat} row={row} first={i === 0} />
        ))}
      </ol>

      <div className="relative mt-auto flex items-center justify-between gap-2.5">
        <span className="flex min-w-0 flex-wrap gap-1.5">
          {awards.map((title) => (
            <span
              key={title}
              className="flex items-center gap-1.5 rounded-full bg-gold/22 px-2.5 py-1.5 text-xs font-semibold text-gold-soft"
            >
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" />
              </svg>
              {title}
            </span>
          ))}
        </span>
        {saved ? (
          <button
            type="button"
            onClick={() => resume.start(saved)}
            aria-label={`Resume the game at table ${match.roomId}`}
            className={action}
          >
            <PlayGlyph />
            Resume
          </button>
        ) : (
          <Link
            to={`/replay/${match.id}`}
            aria-label={`Watch the game at table ${match.roomId} again`}
            className={action}
          >
            <PlayGlyph />
            Watch again
          </Link>
        )}
      </div>
    </li>
  );
}

function PlayGlyph(): React.ReactElement {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4v16l13-8z" />
    </svg>
  );
}

/** One player's final score: their face, name, a bar against the top score, and the total. */
function ScoreLine({
  row,
  first,
}: {
  readonly row: ScoreRow;
  readonly first: boolean;
}): React.ReactElement {
  const { player, you, share } = row;
  const color = player.bot
    ? LEVEL_COLOR[player.botLevel ?? "standard"]
    : BACKGROUND_COLORS[faceOf(player).background];
  return (
    <li className={`flex items-center gap-2.5 ${player.left ? "opacity-60" : ""}`}>
      <span
        className={`shrink-0 rounded-full ${
          you ? "shadow-[0_0_0_2px_#FFFFFF]" : "shadow-[0_0_0_2px_rgba(0,0,0,0.25)]"
        }`}
      >
        <PlayerFace player={player} size={30} />
      </span>
      <span
        className={`w-[76px] shrink-0 truncate text-sm ${you ? "font-bold" : "font-medium"}`}
        title={player.name}
      >
        {you ? "You" : player.name}
        {player.bot && <span className="sr-only"> (computer)</span>}
        {player.left && <span className="sr-only"> (left)</span>}
      </span>
      <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded bg-black/28">
        <span
          className="block h-full rounded"
          style={{
            width: `${Math.round(share * 100)}%`,
            background: color,
            boxShadow: first ? `0 0 10px ${color}` : undefined,
          }}
        />
      </span>
      <span className="w-[54px] text-right text-[13px] font-semibold tabular-nums md:w-[58px]">
        {points(player.total)}
      </span>
    </li>
  );
}
