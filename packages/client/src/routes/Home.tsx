/**
 * The home screen: who you are and how you have been doing, the way into a game
 * (open a table, or join one with a code), the games you have going, and the ways
 * to practice, learn and watch.
 *
 * Opening and joining each happen in a sheet over the screen, sharing the name and
 * picture the player sits down with. Arriving from a shared link is the common
 * case: the code is already known, so the join sheet opens at once with it filled
 * in, and the only thing missing is a name.
 *
 * Games saved for later are shown apart from the one table this tab still has a
 * seat at: going back to a saved game is not rejoining a table in progress, it is
 * the start of a gathering, so it leads to that game's waiting room.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  MATCHES_PATH,
  MAX_NAME_LENGTH,
  resolveRules,
  type GameMode,
  type MatchHistory as History,
  type RulesPreset,
} from "@hf/shared";
import { LESSONS } from "@hf/scenarios";
import { createTable, joinTable, resumeSavedGame } from "../actions";
import { loadAvatar, saveAvatar, faceOf } from "../profile/avatarStore";
import { AvatarEditor } from "../profile/AvatarEditor";
import { AvatarFace } from "../profile/Avatar";
import { loadCredentials } from "../credentials";
import { isPossibleRoomCode, normalizeRoomCode } from "../roomCode";
import { loadSavedGames, type SavedGame } from "../savedGames";
import {
  DEFAULT_CHOICE,
  loadRulesChoice,
  rebased,
  rememberRulesChoice,
  type RulesChoice,
} from "../rules/customRules";
import { RulesEditor } from "../rules/RulesEditor";
import { useSession } from "../session";
import { serverUrl, type HfClientSocket } from "../socket";
import {
  httpPost,
  loadIdentity,
  loadName,
  prepareIdentity,
  rememberName,
  type Post,
} from "../identity";
import { usePhone } from "../usePhone";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { IconBox, type IconBoxColor } from "../ui/IconBox";
import { Icon, type IconName } from "../ui/icons";
import { Sheet } from "../ui/Sheet";
import { CodeBoxes } from "../join/CodeBoxes";
import { Scanner } from "../join/Scanner";

/** Development builds, and the screenshot harness's, carry the scenario viewer. */
const SCENARIOS_LINK = import.meta.env.DEV || import.meta.env.VITE_SCENARIOS === "1";

export interface HomeProps {
  readonly socket: HfClientSocket;
  /** How identities reach the server; the page's own origin unless a test answers it. */
  readonly post?: Post;
}

type Open = "new" | "join" | null;

export function Home({ socket, post = httpPost(serverUrl()) }: HomeProps): React.ReactElement {
  const navigate = useNavigate();
  const { roomId: fromLink } = useParams<{ roomId?: string }>();
  const seat = useSession((s) => s.seat);
  const setNotice = useSession((s) => s.setNotice);
  const notice = useSession((s) => s.notice);
  // A seat held in this tab, or one saved by an earlier visit that has not been
  // reclaimed: reloading the home screen leaves it unclaimed until Rejoin.
  const stored = useSession((s) => s.credentials) ?? loadCredentials();
  // Kept until their tables close; one past that is only clutter.
  const [savedGames, setSavedGames] = useState(() =>
    loadSavedGames().filter((g) => g.savedUntil > Date.now()),
  );
  // A seat at a saved game is offered as that, below, not as a table to rejoin.
  const held = stored && !savedGames.some((g) => g.roomId === stored.roomId) ? stored : null;

  // From a shared link the code is known: straight to joining.
  const [open, setOpen] = useState<Open>(fromLink ? "join" : null);
  // The name this player went by last time, ready to use again or change.
  const [name, setName] = useState(loadName);
  // The picture this device chose, if any; changed here, kept at once.
  const [avatar, setAvatar] = useState(loadAvatar);
  const [code, setCode] = useState(fromLink ? normalizeRoomCode(fromLink) : "");
  // The rules this device last opened a table with, ready to use again or change.
  const [choice, setChoice] = useState<RulesChoice>(loadRulesChoice);
  // One flag for both sheets: a request is in flight and none should be sent
  // twice, which double-seats the sender at their own table.
  const [busy, setBusy] = useState(false);
  const history = useHistory(post);

  const named = name.trim() !== "";
  const sink = { seat, setNotice };

  async function resume(game: SavedGame): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (await resumeSavedGame(socket, game, sink)) navigate(`/room/${game.roomId}`);
      // A game that turned out to be gone has been forgotten; stop offering it.
      else setSavedGames(loadSavedGames().filter((g) => g.savedUntil > Date.now()));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent, join: boolean): Promise<void> {
    event.preventDefault();
    if (busy || !named) return;
    setBusy(true);
    try {
      rememberName(name);
      // Who is sitting down, for attributing games later. Without an answer in
      // time the player sits down anyway, as nobody in particular.
      const user = await prepareIdentity(post, name.trim());
      const roomId = join
        ? await joinTable(socket, code, name, sink, user, avatar)
        : await createTable(socket, name, choice, sink, user, avatar);
      // Remembered once a table has actually been opened with them.
      if (roomId && !join) rememberRulesChoice(choice);
      if (roomId) navigate(`/room/${roomId}`);
    } finally {
      // Cleared even on refusal, so a wrong code can be corrected and retried.
      setBusy(false);
    }
  }

  function openSheet(which: Open): void {
    setNotice(null);
    setOpen(which);
  }

  const who = (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-soft">Your name</span>
        <input
          className="min-h-11 rounded-xl border border-white/12 bg-page px-3 text-ink placeholder:text-faint"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ana"
          // First either way, and from a shared link it is the only thing missing.
          autoFocus
          maxLength={MAX_NAME_LENGTH}
        />
      </label>
      <AvatarEditor
        name={name}
        avatar={avatar}
        onChange={(next) => {
          setAvatar(next);
          saveAvatar(next);
        }}
      />
    </>
  );

  const alert = notice && (
    <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">
      {notice}
    </p>
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-5 md:gap-7 md:px-10 md:py-8">
      <Greeting history={history} invited={fromLink !== undefined} />
      {open === null && alert}

      <PlayBanner onNew={() => openSheet("new")} onJoin={() => openSheet("join")} />

      {/* On a phone, your games come first; on a computer the design puts the
          ways to practice and learn above them. */}
      <YourGames
        held={held?.roomId ?? null}
        saved={savedGames}
        busy={busy}
        onRejoin={(roomId) => navigate(`/room/${roomId}`)}
        onResume={(game) => void resume(game)}
      />

      <QuickStart onPractice={() => openSheet("new")} />

      {SCENARIOS_LINK && (
        // A full page load, not a route change: the viewer is mounted in place of
        // the app (see main.tsx), and only in builds that carry it.
        <a href="/scenarios" className="self-start text-sm text-muted underline md:order-2">
          Scenario viewer (development)
        </a>
      )}

      {open === "join" && (
        <JoinSheet
          code={code}
          onCode={setCode}
          // From a shared link the code is already in: on to who is sitting down.
          startWithCode={fromLink !== undefined}
          who={who}
          alert={alert}
          disabled={busy || !named}
          onSubmit={(e) => void submit(e, true)}
          onClose={() => setOpen(null)}
        />
      )}

      {open === "new" && (
        <Sheet title="New table" onClose={() => setOpen(null)}>
          <NewTableForm
            who={who}
            alert={alert}
            choice={choice}
            onChoice={setChoice}
            disabled={busy || !named}
            onSubmit={(e) => void submit(e, false)}
          />
        </Sheet>
      )}
    </main>
  );
}

/**
 * Joining a table: the code first, in six boxes (or read from the table's QR
 * code), then who is sitting down. On a computer the camera sits beside the
 * boxes; on a phone, scanning takes the whole screen.
 */
function JoinSheet({
  code,
  onCode,
  startWithCode,
  who,
  alert,
  disabled,
  onSubmit,
  onClose,
}: {
  readonly code: string;
  readonly onCode: (code: string) => void;
  readonly startWithCode: boolean;
  readonly who: React.ReactNode;
  readonly alert: React.ReactNode;
  readonly disabled: boolean;
  readonly onSubmit: (event: FormEvent) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const phone = usePhone();
  const [step, setStep] = useState<"code" | "who">(
    startWithCode && isPossibleRoomCode(code) ? "who" : "code",
  );
  const [scanning, setScanning] = useState(false);
  const read = (found: string): void => {
    onCode(found);
    setScanning(false);
    setStep("who");
  };

  if (phone && scanning) {
    return (
      <Sheet title="Scan the table's QR code" onClose={() => setScanning(false)}>
        <Scanner onCode={read} autoStart />
        <Button variant="secondary" size="lg" onClick={() => setScanning(false)}>
          Type the code instead
        </Button>
      </Sheet>
    );
  }

  const codeStep = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPossibleRoomCode(code)) setStep("who");
      }}
    >
      <p className="m-0 text-sm text-muted">Type the six letters from your host</p>
      <CodeBoxes value={code} onChange={onCode} autoFocus />
      {alert}
      <Button
        type="submit"
        size="lg"
        // Disabled rather than validated on submit, so an impossible code never
        // costs a round trip; the server still has the final say on whether the
        // table exists.
        disabled={!isPossibleRoomCode(code)}
      >
        Continue
      </Button>
      {phone ? (
        <>
          <div className="flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-white/10" />
            or
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex min-h-[60px] items-center gap-3.5 rounded-[18px] border border-white/10 bg-surface px-4 text-left hover:border-white/20"
          >
            <IconBox icon="scan" color="accent" size={40} />
            <span className="flex-1">
              <span className="block font-display text-[15px] font-semibold">
                Scan the table&rsquo;s QR code
              </span>
              <span className="block text-xs text-muted">From the host&rsquo;s screen</span>
            </span>
            <Icon name="forward" size={18} className="text-muted" />
          </button>
        </>
      ) : (
        <p className="m-0 text-xs text-faint">Got a link instead? Opening it skips this step.</p>
      )}
    </form>
  );

  const whoStep = (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <p className="m-0 flex items-center justify-between gap-3 text-sm text-muted">
        <span>
          Table <span className="font-mono font-bold text-ink">{code}</span>
        </span>
        <button
          type="button"
          onClick={() => setStep("code")}
          className="text-accent underline hover:text-accent-hover"
        >
          Change code
        </button>
      </p>
      {who}
      {alert}
      <Button type="submit" size="lg" disabled={disabled || !isPossibleRoomCode(code)}>
        Join table
      </Button>
    </form>
  );

  return (
    <Sheet title="Join a table" onClose={onClose} wide={!phone && step === "code"}>
      {step === "code" && !phone ? (
        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-8">
          {codeStep}
          <div className="flex flex-col items-center gap-3 border-l border-white/8 pl-8">
            <h3 className="m-0 text-center font-display text-lg font-semibold">
              Or scan the table&rsquo;s QR code
            </h3>
            <Scanner onCode={read} />
          </div>
        </div>
      ) : step === "code" ? (
        codeStep
      ) : (
        whoStep
      )}
    </Sheet>
  );
}

/** The house rules for a new table, and the button that opens it. */
function NewTableForm({
  who,
  alert,
  choice,
  onChoice,
  disabled,
  onSubmit,
}: {
  readonly who: React.ReactNode;
  readonly alert: React.ReactNode;
  readonly choice: RulesChoice;
  readonly onChoice: (choice: RulesChoice) => void;
  readonly disabled: boolean;
  readonly onSubmit: (event: FormEvent) => void;
}): React.ReactElement {
  const { preset, mode } = choice;
  // The server's own check, asked as the rules are edited; the server asks again.
  const checked = resolveRules(choice);
  const changes = Object.keys(choice.rules).length;
  const select =
    "min-h-10 rounded-xl border border-white/12 bg-page px-3 text-sm text-ink focus-visible:outline-accent";
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      {who}
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-xs font-semibold tracking-[0.06em] text-quiet uppercase">
          House rules
        </legend>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-soft">Variant</span>
          <select
            className={select}
            value={preset}
            onChange={(e) => onChoice(rebased(choice, e.target.value as RulesPreset, mode))}
          >
            <option value="east-coast">East Coast</option>
            <option value="west-coast">West Coast</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-soft">Mode</span>
          <select
            className={select}
            value={mode}
            onChange={(e) => onChoice(rebased(choice, preset, e.target.value as GameMode))}
          >
            <option value="family">Family</option>
            <option value="competitive">Competitive</option>
          </select>
        </label>
        <details className="rounded-[14px] border border-white/8 bg-raised/60 p-3 text-sm">
          <summary className="cursor-pointer text-ink-soft">
            Change the rules
            {changes > 0 && (
              <Chip tone="gold" className="ml-2">
                {changes} changed
              </Chip>
            )}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <RulesEditor choice={choice} onChange={onChoice} />
            {changes > 0 && (
              <button
                type="button"
                onClick={() => onChoice({ ...DEFAULT_CHOICE, preset, mode })}
                className="self-start text-xs text-muted underline"
              >
                Back to the preset&rsquo;s rules
              </button>
            )}
          </div>
        </details>
        {!checked.ok && (
          <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">
            {capitalize(checked.error)}.
          </p>
        )}
      </fieldset>
      {alert}
      <Button type="submit" size="lg" disabled={disabled || !checked.ok}>
        Open a new table
      </Button>
    </form>
  );
}

/**
 * The player's history, asked of the server for this browser's identity if it has
 * one. Null until (and unless) it answers: a greeting without numbers is fine, and
 * the home screen never waits on it.
 */
function useHistory(post: Post): History | null {
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
  return history;
}

/** "Morning", "Afternoon" or "Evening", by the device's clock. */
export function partOfDay(hour: number): string {
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/** The greeting at the top, with the player's record once there is one. */
function Greeting({
  history,
  invited,
}: {
  readonly history: History | null;
  readonly invited: boolean;
}): React.ReactElement {
  const phone = usePhone();
  const name = loadName().trim();
  const title = name ? `${partOfDay(new Date().getHours())}, ${name}` : "Hand and Foot";
  const stats =
    history && history.stats.played + history.stats.unfinished > 0 ? history.stats : null;
  const awards = stats ? Object.values(stats.awards ?? {}).reduce((a, b) => a + b, 0) : 0;
  const won = stats && stats.played > 0 ? Math.round((100 * stats.wins) / stats.played) : null;
  const line = invited
    ? "You were invited to a table."
    : stats
      ? null
      : "Open a table, or join one with a code.";

  if (phone) {
    return (
      <header className="flex items-center gap-3">
        <AvatarFace avatar={loadAvatar() ?? faceOf({ name: name || "?" })} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate font-display text-base font-semibold">{title}</h1>
          <p className="m-0 text-xs text-muted">
            {line ??
              [
                `${stats!.played} game${stats!.played === 1 ? "" : "s"}`,
                won !== null ? `${won}% won` : null,
                `${awards} award${awards === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
          </p>
        </div>
      </header>
    );
  }
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="m-0 font-display text-[32px] font-bold tracking-[-0.02em]">{title}</h1>
        {line && <p className="mt-1 text-muted">{line}</p>}
      </div>
      {stats && (
        <dl className="m-0 flex gap-7">
          {(
            [
              ["Games", String(stats.played)],
              ["Won", won === null ? "–" : `${won}%`],
              ["Awards", String(awards)],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="m-0 font-display text-[22px] font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

/** The green banner: the two ways into a game with friends. */
function PlayBanner({
  onNew,
  onJoin,
}: {
  readonly onNew: () => void;
  readonly onJoin: () => void;
}): React.ReactElement {
  return (
    <section
      aria-label="Play"
      className="relative flex min-h-[236px] flex-col justify-end gap-3.5 overflow-hidden rounded-[22px] p-5 md:min-h-[220px] md:gap-[18px] md:rounded-3xl md:p-8"
      style={{ background: "radial-gradient(120% 110% at 85% 5%, #2F7A5C, #164433 55%, #0F2D22)" }}
    >
      <BannerCards />
      <h2 className="relative m-0 font-display text-[28px] font-bold tracking-[-0.02em] md:text-[40px]">
        Play with friends
      </h2>
      <div className="relative flex gap-2.5 md:max-w-md">
        <Button size="lg" className="flex-1" onClick={onNew}>
          New table
        </Button>
        <Button size="lg" variant="secondary" className="flex-1" onClick={onJoin}>
          <Icon name="qr" size={18} className="hidden md:block" />
          Join with code
        </Button>
      </div>
    </section>
  );
}

/** Three cards fanned in the banner's corner: a king, an ace and a back. Decoration. */
function BannerCards(): React.ReactElement {
  const face =
    "absolute w-[62px] h-[86px] md:w-[96px] md:h-[134px] rounded-lg md:rounded-xl bg-card shadow-[0_10px_20px_rgba(0,0,0,0.35)] px-2 py-1.5 md:px-2.5 md:py-2 font-display font-bold text-lg md:text-[26px] leading-none";
  return (
    <div
      aria-hidden="true"
      className="absolute top-5 right-[18px] h-[110px] w-[150px] md:top-7 md:right-12 md:h-[170px] md:w-[240px]"
    >
      <div className={`${face} top-3.5 left-5 -rotate-[16deg] text-suit-red md:top-5`}>
        K&#x2665;&#xFE0E;
      </div>
      <div className={`${face} top-1 left-[52px] -rotate-2 text-suit-black md:left-[72px]`}>
        A&#x2660;&#xFE0E;
      </div>
      <div
        className={`${face} top-3 left-[84px] rotate-[14deg] border-4 border-card md:left-[124px]`}
        style={{
          background: "repeating-linear-gradient(45deg, #4ADE9B 0 6px, #2BB57A 6px 12px)",
        }}
      />
    </div>
  );
}

/** The table this tab holds a seat at, and the games saved for later. */
function YourGames({
  held,
  saved,
  busy,
  onRejoin,
  onResume,
}: {
  readonly held: string | null;
  readonly saved: readonly SavedGame[];
  readonly busy: boolean;
  readonly onRejoin: (roomId: string) => void;
  readonly onResume: (game: SavedGame) => void;
}): React.ReactElement | null {
  if (held === null && saved.length === 0) return null;
  const card =
    "flex min-h-[132px] min-w-0 flex-col items-start gap-1.5 rounded-[18px] border bg-surface p-3 text-left md:min-h-[150px] md:gap-2 md:p-4";
  return (
    <section aria-label="Your games" className="flex flex-col gap-2.5 md:order-1">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 font-display text-base font-semibold md:text-xl">Your games</h2>
        <Link to="/history" className="text-[13px] text-accent underline hover:text-accent-hover">
          History
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {held !== null && (
          <section aria-label="Your table" className={`${card} border-accent/50`}>
            <Chip tone="accent">In progress</Chip>
            <span className="text-sm font-semibold text-ink">Your seat at table {held}</span>
            <span className="text-xs text-muted">You still have a seat here.</span>
            <Button size="md" className="mt-auto" onClick={() => onRejoin(held)}>
              Rejoin
            </Button>
          </section>
        )}
        {saved.length > 0 && (
          <div role="region" aria-label="Saved games" className="contents">
            {saved.map((game) => (
              <div key={game.roomId} className={`${card} border-white/7`}>
                <Chip>Saved · {formatWeekday(game.savedUntil)}</Chip>
                <Faces names={game.names} />
                <span className="w-full truncate text-sm font-semibold text-ink">
                  {game.names.join(", ")}
                </span>
                <span className="text-xs text-muted">
                  Table {game.roomId} · round {game.round} · kept until {formatDay(game.savedUntil)}
                </span>
                <Button
                  size="md"
                  variant="secondary"
                  className="mt-auto"
                  disabled={busy}
                  onClick={() => onResume(game)}
                  aria-label={`Resume the game at table ${game.roomId}`}
                >
                  Resume
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** The people at a table as overlapping faces, drawn from their names. */
function Faces({ names }: { readonly names: readonly string[] }): React.ReactElement {
  return (
    <span className="flex" aria-hidden="true">
      {names.slice(0, 4).map((n, i) => (
        <span
          key={`${n}${i}`}
          className={`rounded-full border-2 border-surface ${i > 0 ? "-ml-2" : ""}`}
        >
          <AvatarFace avatar={faceOf({ name: n })} size={26} />
        </span>
      ))}
    </span>
  );
}

interface Tile {
  readonly label: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly color: IconBoxColor;
  readonly tint: string;
}

const TILES: readonly (Tile & { readonly to?: string })[] = [
  {
    label: "Practice vs computers",
    detail: "Pick how many and how hard",
    icon: "bot",
    color: "blue",
    tint: "#8FB8E8",
  },
  {
    label: "Learn in 5 minutes",
    detail: `${LESSONS.length} short lessons`,
    icon: "book",
    color: "gold",
    tint: "#F2C14E",
    to: "/learn",
  },
  {
    label: "Watch a demo game",
    detail: "Watch a game play out, move by move",
    icon: "playCircle",
    color: "violet",
    tint: "#D6A6F0",
    to: "/learn/demo",
  },
];

/** Practice, learn, watch: the three ways in besides playing with friends. */
function QuickStart({ onPractice }: { readonly onPractice: () => void }): React.ReactElement {
  const phone = usePhone();
  return (
    <section aria-label="Quick start" className="grid grid-cols-3 gap-2.5 md:gap-6">
      {TILES.map((tile) => {
        const inner = (
          <>
            <IconBox icon={tile.icon} color={tile.color} size={phone ? 36 : 44} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] leading-tight font-semibold md:font-display md:text-lg">
                {tile.label}
              </span>
              {!phone && <span className="text-sm text-muted">{tile.detail}</span>}
            </span>
          </>
        );
        const className =
          "flex min-h-[100px] flex-col items-start justify-between gap-2 rounded-2xl border border-white/7 p-3 text-left text-ink hover:border-white/15 md:min-h-0 md:flex-row md:items-center md:justify-start md:gap-4 md:p-5";
        const style = { background: `linear-gradient(160deg, ${tile.tint}1A, #171B20 70%)` };
        return tile.to ? (
          <Link key={tile.label} to={tile.to} className={className} style={style}>
            {inner}
          </Link>
        ) : (
          <button
            key={tile.label}
            type="button"
            onClick={onPractice}
            className={className}
            style={style}
          >
            {inner}
          </button>
        );
      })}
    </section>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatWeekday(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: "short" });
}
