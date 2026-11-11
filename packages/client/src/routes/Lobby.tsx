/**
 * The waiting room: the table drawn from above with everyone in their seat, the
 * code and the ways to invite the rest, and, for the host, the computers and the
 * Deal button. A guest sees who is hosting, what they changed in the rules, and
 * can change their own card or leave.
 *
 * Only the host's client offers Deal, mirroring the server's rule rather than
 * duplicating its reasoning — `hostSeat` says whose it is. The seat count gates it
 * too, because the server refuses under two players and an enabled button that
 * bounces is worse than one that explains itself.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BOT_LEVELS,
  MAX_BOT_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type BotLevel,
  type RoomInfo,
  type RoomPlayerInfo,
} from "@hf/shared";
import { AvatarFace } from "../profile/Avatar";
import { faceOf, loadAvatar, saveAvatar } from "../profile/avatarStore";
import { PlayerCard } from "../profile/PlayerCard";
import {
  addComputerPlayer,
  changeMyCard,
  leaveTable,
  makeHost,
  removeComputerPlayer,
  startTable,
  updateComputerPlayer,
} from "../actions";
import { loadAccount, rememberName } from "../identity";
import { BotFace, LEVEL_COLOR, LEVEL_WORDS, suggestBotName } from "../home/sheets";
import { roomLink, watchLink } from "../roomCode";
import { RulesSummary } from "../rules/RulesSummary";
import { ruleLines, rulesName } from "../rules/ruleText";
import { useSession } from "../session";
import type { HfClientSocket } from "../socket";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/icons";
import { QrCode } from "../ui/QrCode";
import { Sheet } from "../ui/Sheet";
import { usePhone } from "../usePhone";

export interface LobbyProps {
  readonly socket: HfClientSocket;
}

/** The code as the design prints it: two halves with a dot between, "K7Q·M2P". */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}·${code.slice(3)}` : code;
}

type Open = "qr" | "rules" | "card" | null;

export function Lobby({ socket }: LobbyProps): React.ReactElement {
  const room = useSession((s) => s.room);
  const credentials = useSession((s) => s.credentials);
  const setNotice = useSession((s) => s.setNotice);
  const seat = useSession((s) => s.seat);
  const notice = useSession((s) => s.notice);
  const leave = useSession((s) => s.leave);
  const navigate = useNavigate();
  const phone = usePhone();
  const [copied, setCopied] = useState<"link" | "watch" | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  // The room event is what populates this, and it arrives just after the seat is
  // granted, so a moment of nothing is normal rather than an error.
  if (!room) {
    return (
      <main className="min-h-full bg-page p-6 text-muted">
        <p className="mx-auto max-w-md">Joining the table&hellip;</p>
      </main>
    );
  }

  const me = credentials?.seat ?? -1;
  const isHost = me === room.hostSeat;
  const host = room.players.find((p) => p.seat === room.hostSeat);
  const enough = room.players.length >= MIN_PLAYERS;
  const full = room.players.length >= MAX_PLAYERS;
  const sink = { seat, setNotice };
  /** Run a request with the buttons held, so a double click does not send it twice. */
  const hold = (request: Promise<unknown>): void => {
    setBusy(true);
    void request.finally(() => setBusy(false));
  };
  const link = roomLink(room.roomId, window.location.origin);
  const watch = watchLink(room.roomId, window.location.origin);
  const changed = ruleLines(room.config).filter((line) => line.was !== null);

  async function copy(what: "link" | "watch"): Promise<void> {
    try {
      await navigator.clipboard.writeText(what === "link" ? link : watch);
      setCopied(what);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations — an insecure
      // origin, a permission prompt declined. The link is in the QR sheet to be
      // copied by hand, so this is not worth an error.
      setCopied(null);
    }
  }

  /** The phone's share sheet where there is one; copying the link where not. */
  function share(): void {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      void nav.share({ title: "Hand and Foot", url: link }).catch(() => {});
    } else void copy("link");
  }

  const leaveNow = (): void => {
    // Without this the stored credentials are a trap: a seat at a table that
    // never deals would be reclaimed on every load with no way to get out.
    setBusy(true);
    void leaveTable(socket, { leave }).then(() => navigate("/"));
  };

  const alert = notice && (
    <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">
      {notice}
    </p>
  );

  const ring = (
    <SeatRing
      room={room}
      me={me}
      isHost={isHost}
      busy={busy}
      onInvite={share}
      onMakeHost={(target) => hold(makeHost(socket, target, sink))}
      center={
        !isHost && !phone ? (
          <>
            <span className="font-display text-lg font-semibold text-ink/80">
              Waiting for {host?.name ?? "the host"}
            </span>
            <span className="text-sm text-ink/50">to deal</span>
          </>
        ) : (
          <>
            <span className="font-display text-base font-semibold text-ink/80 md:text-lg">
              {rulesName(room.config)}
            </span>
            <span className="text-sm text-ink/50">
              {room.config.rounds} round{room.config.rounds === 1 ? "" : "s"}
            </span>
          </>
        )
      }
    />
  );

  const deal = isHost && (
    <div className="flex flex-col gap-2">
      <Button size="lg" disabled={busy || !enough} onClick={() => hold(startTable(socket, sink))}>
        {enough
          ? `Deal · ${room.players.length} players`
          : `Waiting for ${MIN_PLAYERS - room.players.length} more`}
      </Button>
      <p className="m-0 text-center text-xs text-quiet md:text-left">
        Empty seats stay empty. {phone ? "Tap" : "Click"} a computer to rename it or change how well
        it plays.
      </p>
    </div>
  );

  const computers = isHost && (
    <LobbyComputers
      players={room.players.filter((p) => p.bot)}
      openSeats={MAX_PLAYERS - room.players.length}
      full={full}
      busy={busy}
      onAdd={() => hold(addComputerPlayer(socket, sink))}
      onUpdate={(target, settings) => hold(updateComputerPlayer(socket, target, settings, sink))}
      onRemove={(target) => hold(removeComputerPlayer(socket, target, sink))}
    />
  );

  const rulesRow = (
    <button
      type="button"
      onClick={() => setOpen("rules")}
      className="flex min-h-14 items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-[#1A1F24] px-4 py-2 text-left hover:border-white/15"
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">
          {isHost ? "House rules" : "Table rules"}
          {isHost && changed.length > 0 && (
            <span className="text-gold"> · {changed.length} changed</span>
          )}
        </span>
        {!isHost && (
          <span className="block text-xs text-quiet">
            {changed.length > 0
              ? `${host?.name ?? "The host"} changed ${changed.length} house rule${changed.length === 1 ? "" : "s"}`
              : `${rulesName(room.config)}, as it comes`}
          </span>
        )}
      </span>
      <Icon name="forward" size={18} className="text-muted" />
    </button>
  );

  const guestButtons = !isHost && (
    <div className="grid grid-cols-2 gap-3">
      <Button size="lg" variant="secondary" onClick={() => setOpen("card")}>
        Change my card
      </Button>
      <Button
        size="lg"
        disabled={busy}
        onClick={leaveNow}
        className="!bg-danger/12 !text-danger-soft hover:!bg-danger/20"
      >
        Leave table
      </Button>
    </div>
  );

  const waitingBanner = !isHost && host && (
    <section
      aria-label="Waiting for the deal"
      className="flex items-center gap-3 rounded-[18px] border border-violet/30 bg-violet/10 p-4"
    >
      <AvatarFace avatar={faceOf(host)} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[17px] font-semibold">
          {phone ? `Waiting for ${host.name} to deal` : `${host.name} is the host`}
        </span>
        <span className="block text-sm text-muted">
          {phone
            ? "You'll go straight to your hand when it starts"
            : `You'll go straight to your hand when ${host.name} deals.`}
        </span>
      </span>
      {phone && (
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-2 rounded-full bg-violet"
              style={{ opacity: 1 - i * 0.3 }}
            />
          ))}
        </span>
      )}
    </section>
  );

  const sheets = (
    <>
      {open === "qr" && (
        <Sheet title="Invite to the table" onClose={() => setOpen(null)}>
          <div className="flex flex-col items-center gap-4">
            <QrCode value={link} label={`QR code to join table ${room.roomId}`} size={220} />
            <p className="m-0 text-center text-sm text-muted">
              Scan with a phone&rsquo;s camera to come to the table.
            </p>
            <InviteLinks
              copied={copied}
              onCopy={(what) => void copy(what)}
              watching={room.watching}
            />
          </div>
        </Sheet>
      )}
      {open === "rules" && (
        <Sheet title={isHost ? "House rules" : "Table rules"} onClose={() => setOpen(null)}>
          <RulesSummary config={room.config} />
        </Sheet>
      )}
      {open === "card" && (
        <ChangeCard
          player={room.players.find((p) => p.seat === me)}
          busy={busy}
          onSave={(card) =>
            hold(
              changeMyCard(socket, card, sink).then((ok) => {
                if (ok) {
                  rememberName(card.name);
                  saveAvatar(card.avatar);
                  setOpen(null);
                }
              }),
            )
          }
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );

  if (phone) {
    return (
      <main className="flex min-h-full flex-col gap-5 bg-page px-5 py-5 text-ink">
        <header className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to the home screen"
            onClick={() => navigate("/")}
            className="flex size-11 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-surface"
          >
            <Icon name="back" size={18} />
          </button>
          {isHost ? (
            <span className="flex-1" />
          ) : (
            <span className="min-w-0 flex-1">
              <h1 className="m-0 truncate font-display text-xl font-semibold">
                {host ? `${host.name}’s table` : `Table ${room.roomId}`}
              </h1>
              <span className="text-sm text-muted">
                Code <span className="font-mono text-ink">{spacedCode(room.roomId)}</span>
              </span>
            </span>
          )}
          {isHost ? (
            <Chip tone="accent" className="!bg-accent/15 !px-3 !py-1.5 !text-sm !text-accent">
              You&rsquo;re the host
            </Chip>
          ) : (
            <Button variant="secondary" onClick={() => setOpen("qr")}>
              Invite
            </Button>
          )}
        </header>
        {isHost && (
          <section aria-label="Table code" className="flex flex-col items-center gap-3">
            <h1 className="m-0 font-mono text-[56px] leading-none font-bold tracking-tight">
              <span className="sr-only">Table {room.roomId}</span>
              <span aria-hidden="true">{spacedCode(room.roomId)}</span>
            </h1>
            <div className="flex gap-2.5">
              <Button variant="secondary" onClick={share}>
                Share link
              </Button>
              <Button variant="secondary" onClick={() => setOpen("qr")}>
                Show QR
              </Button>
            </div>
          </section>
        )}
        {waitingBanner}
        {ring}
        {computers}
        {rulesRow}
        {alert}
        <div className="mt-auto flex flex-col gap-3">
          {deal}
          {guestButtons}
          {isHost && (
            <button
              type="button"
              disabled={busy}
              onClick={leaveNow}
              className="self-center text-sm text-quiet underline"
            >
              Leave table
            </button>
          )}
        </div>
        {sheets}
      </main>
    );
  }

  return (
    <main className="min-h-full bg-page px-10 py-8 text-ink">
      <header className="flex items-center justify-between gap-4">
        {isHost ? (
          <div className="flex items-center gap-4">
            <Button variant="secondary" disabled={busy} onClick={leaveNow}>
              <Icon name="back" size={16} />
              Leave table
            </Button>
            <Chip tone="accent" className="!bg-accent/15 !px-3 !py-1.5 !text-sm !text-accent">
              You&rsquo;re the host
            </Chip>
          </div>
        ) : (
          <div>
            <h1 className="m-0 font-display text-[32px] font-bold tracking-[-0.02em]">
              {host ? `${host.name}’s table` : `Table ${room.roomId}`}
            </h1>
            <p className="m-0 text-muted">
              Code <span className="font-mono text-ink">{spacedCode(room.roomId)}</span> ·{" "}
              {rulesName(room.config)} · {room.config.rounds} round
              {room.config.rounds === 1 ? "" : "s"}
            </p>
          </div>
        )}
        {isHost ? (
          room.watching !== undefined && (
            <span className="text-muted">{room.watching} watching</span>
          )
        ) : (
          <Button variant="secondary" onClick={() => void copy("link")}>
            {copied === "link" ? "Copied" : "Copy invite link"}
          </Button>
        )}
      </header>
      <div
        className={`mt-8 grid gap-10 ${isHost ? "grid-cols-[260px_minmax(0,1fr)_340px]" : "grid-cols-[minmax(0,1fr)_380px]"}`}
      >
        {isHost && (
          <section aria-label="Table code" className="flex flex-col gap-4">
            <p className="m-0 text-xs font-semibold tracking-[0.12em] text-quiet uppercase">
              Table code
            </p>
            <h1 className="m-0 font-mono text-[64px] leading-none font-bold tracking-tight">
              <span className="sr-only">Table {room.roomId}</span>
              <span aria-hidden="true">{spacedCode(room.roomId)}</span>
            </h1>
            <QrCode value={link} label={`QR code to join table ${room.roomId}`} size={180} />
            <InviteLinks copied={copied} onCopy={(what) => void copy(what)} watching={undefined} />
          </section>
        )}
        {ring}
        <aside className="flex flex-col gap-4">
          {waitingBanner}
          {!isHost && changed.length > 0 && (
            <section className="flex flex-col gap-2 rounded-[18px] border border-white/8 bg-surface p-5">
              <h2 className="m-0 font-display text-lg font-semibold">
                {host?.name ?? "The host"} changed {changed.length} rule
                {changed.length === 1 ? "" : "s"}
              </h2>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-soft">
                {changed.map((line) => (
                  <li key={line.id}>
                    {line.label}: {line.value}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setOpen("rules")}
                className="self-start text-sm font-semibold text-accent underline"
              >
                Read all the table&rsquo;s rules
              </button>
            </section>
          )}
          {computers}
          {(isHost || changed.length === 0) && rulesRow}
          {alert}
          {deal}
          {guestButtons}
        </aside>
      </div>
      {sheets}
    </main>
  );
}

/** Copy link and Watch link, each confirming when the clipboard took it. */
function InviteLinks({
  copied,
  onCopy,
  watching,
}: {
  readonly copied: "link" | "watch" | null;
  readonly onCopy: (what: "link" | "watch") => void;
  readonly watching: number | undefined;
}): React.ReactElement {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => onCopy("link")}>
          {copied === "link" ? "Copied" : "Copy link"}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => onCopy("watch")}
          aria-label={copied === "watch" ? "Copied the watch link" : "Copy the watch link"}
        >
          {copied === "watch" ? "Copied" : "Watch link"}
        </Button>
      </div>
      <p className="m-0 text-xs text-quiet">
        The watch link lets someone follow the game with every hand hidden.
        {watching !== undefined && ` ${watching} watching.`}
      </p>
    </div>
  );
}

/**
 * The table from above, everyone round it: you at the near edge, the others in
 * seat order going round, and the empty seats (an invitation, to the host).
 */
function SeatRing({
  room,
  me,
  isHost,
  busy,
  onInvite,
  onMakeHost,
  center,
}: {
  readonly room: RoomInfo;
  readonly me: number;
  readonly isHost: boolean;
  readonly busy: boolean;
  readonly onInvite: () => void;
  readonly onMakeHost: (seat: number) => void;
  readonly center: React.ReactNode;
}): React.ReactElement {
  const phone = usePhone();
  const players = room.players;
  const total = Math.min(
    MAX_PLAYERS,
    Math.max(6, players.length + (players.length < MAX_PLAYERS ? 1 : 0)),
  );
  // Seat order from yours, so you are at the near edge and the rest go round.
  const start = Math.max(
    0,
    players.findIndex((p) => p.seat === me),
  );
  const order = [...players.slice(start), ...players.slice(0, start)];
  const face = phone ? 48 : 64;
  return (
    <section
      aria-label="Around the table"
      className={`relative mx-auto w-full ${phone ? "h-[400px] max-w-[360px]" : "h-[620px] max-w-[760px]"}`}
    >
      <div
        className={`absolute ${phone ? "inset-x-[16%] inset-y-[15%]" : "inset-x-[12%] inset-y-[17%]"} flex flex-col items-center justify-center gap-1 rounded-[200px] text-center`}
        style={{
          background: "radial-gradient(ellipse at 50% 40%, #2C6B53, #1A4535 70%, #143629)",
          boxShadow:
            "inset 0 0 0 10px #3A2A1C, inset 0 0 0 12px #5A4330, 0 30px 60px rgba(0,0,0,0.45)",
        }}
      >
        {center}
      </div>
      <ul className="m-0 list-none p-0">
        {Array.from({ length: total }, (_, i) => {
          const a = Math.PI / 2 + (2 * Math.PI * i) / total;
          const left = 50 + (phone ? 40 : 38) * Math.cos(a);
          const top = 50 + 38 * Math.sin(a);
          const player = order[i];
          return (
            <li
              key={player ? `p${player.seat}` : `open${i}`}
              className="absolute flex w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center"
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              {player ? (
                <SeatFace
                  player={player}
                  you={player.seat === me}
                  host={player.seat === room.hostSeat}
                  size={face}
                  makeHost={
                    isHost && player.seat !== room.hostSeat && !player.bot
                      ? () => onMakeHost(player.seat)
                      : undefined
                  }
                  busy={busy}
                />
              ) : (
                <>
                  {isHost ? (
                    <button
                      type="button"
                      onClick={onInvite}
                      aria-label="Invite someone to this seat"
                      className="rounded-full border-2 border-dashed border-accent/50"
                      style={{ width: face, height: face }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="rounded-full border-2 border-dashed border-white/25"
                      style={{ width: face, height: face }}
                    />
                  )}
                  <span className="text-sm font-semibold">Open seat</span>
                  {isHost && <span className="text-xs text-accent">invite</span>}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One seat: the face, the name, and what to know about them. */
function SeatFace({
  player,
  you,
  host,
  size,
  makeHost,
  busy,
}: {
  readonly player: RoomPlayerInfo;
  readonly you: boolean;
  readonly host: boolean;
  readonly size: number;
  readonly makeHost: (() => void) | undefined;
  readonly busy: boolean;
}): React.ReactElement {
  const level = player.bot ? (player.botLevel ?? "hard") : null;
  const ring = you ? "#4ADE9B" : level ? LEVEL_COLOR[level] : "#0F1215";
  return (
    <>
      <span className="rounded-full" style={{ boxShadow: `0 0 0 3px #0F1215, 0 0 0 6px ${ring}` }}>
        {level ? (
          <BotFace level={level} size={size} />
        ) : (
          <AvatarFace avatar={faceOf(player)} size={size} />
        )}
      </span>
      <span className="mt-1 text-sm font-semibold">
        {you ? (
          <>
            You<span className="sr-only"> ({player.name})</span>
          </>
        ) : (
          player.name
        )}
      </span>
      {level ? (
        <span className="text-xs" style={{ color: LEVEL_COLOR[level] }}>
          {LEVEL_WORDS[level]}
          <span className="sr-only">, computer</span>
        </span>
      ) : !player.connected ? (
        <span className="text-xs text-orange">reconnecting</span>
      ) : host ? (
        <span className="text-xs text-muted">host</span>
      ) : null}
      {makeHost && (
        <button
          type="button"
          disabled={busy}
          onClick={makeHost}
          aria-label={`Make ${player.name} the host`}
          className="text-[11px] text-quiet underline hover:text-ink disabled:opacity-40"
        >
          make host
        </button>
      )}
    </>
  );
}

/** The host's computers: a chip each, with the editor for the one being changed. */
function LobbyComputers({
  players,
  openSeats,
  full,
  busy,
  onAdd,
  onUpdate,
  onRemove,
}: {
  readonly players: readonly RoomPlayerInfo[];
  readonly openSeats: number;
  readonly full: boolean;
  readonly busy: boolean;
  readonly onAdd: () => void;
  readonly onUpdate: (seat: number, settings: { level?: BotLevel; name?: string }) => void;
  readonly onRemove: (seat: number) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const bot = players.find((p) => p.seat === editing);
  const finish = (): void => {
    if (bot && draftName.trim() !== bot.name) onUpdate(bot.seat, { name: draftName });
    setEditing(null);
  };
  return (
    <section aria-label="Computer players" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-xs font-semibold tracking-[0.06em] text-quiet uppercase md:font-display md:text-lg md:tracking-normal md:text-ink md:normal-case">
          Computer players
        </h2>
        <span className="text-sm text-quiet">
          {openSeats} seat{openSeats === 1 ? "" : "s"} open
        </span>
      </div>
      <div className="flex flex-wrap gap-3 md:flex-col">
        {players.map((p) => {
          const level = p.botLevel ?? "hard";
          const on = editing === p.seat;
          return (
            <button
              key={p.seat}
              type="button"
              aria-label={`Edit ${p.name}, ${LEVEL_WORDS[level]}`}
              aria-expanded={on}
              onClick={() => {
                if (on) finish();
                else {
                  setEditing(p.seat);
                  setDraftName(p.name);
                }
              }}
              className="flex min-h-14 items-center gap-3 rounded-[16px] border bg-surface pr-4 pl-3 text-left"
              style={{ borderColor: on ? LEVEL_COLOR[level] : "rgba(255,255,255,0.08)" }}
            >
              <BotFace level={level} size={34} />
              <span className="flex-1">
                <span className="block text-[15px] font-semibold">{p.name}</span>
                <span className="block text-xs font-semibold" style={{ color: LEVEL_COLOR[level] }}>
                  {LEVEL_WORDS[level]}
                </span>
              </span>
              <Icon name="pencil" size={16} className="text-muted" />
            </button>
          );
        })}
        {bot && (
          <div className="flex w-full flex-col gap-3 rounded-[18px] border border-white/10 bg-sheet p-4">
            <div className="flex items-center gap-3">
              <BotFace level={bot.botLevel ?? "hard"} size={44} />
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs text-quiet">Name at the table</span>
                <input
                  value={draftName}
                  maxLength={MAX_BOT_NAME_LENGTH}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="min-h-11 rounded-xl border border-white/12 bg-page px-3 text-ink"
                />
              </label>
              <button
                type="button"
                aria-label="Suggest a name"
                onClick={() =>
                  setDraftName(
                    suggestBotName(
                      draftName,
                      players.map((p) => p.name),
                    ),
                  )
                }
                className="flex size-11 items-center justify-center self-end rounded-xl border border-white/12 hover:bg-white/5"
              >
                <Icon name="dice" size={18} />
              </button>
            </div>
            <div
              role="radiogroup"
              aria-label="How hard"
              className="grid grid-cols-3 gap-1 rounded-xl bg-page p-1"
            >
              {BOT_LEVELS.map((level) => {
                const on = (bot.botLevel ?? "hard") === level;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => onUpdate(bot.seat, { level })}
                    className="min-h-[38px] rounded-[9px] text-[13px] font-semibold"
                    style={
                      on
                        ? { background: LEVEL_COLOR[level], color: "#0B2340" }
                        : { color: "#9AA3AD" }
                    }
                  >
                    {LEVEL_WORDS[level]}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onRemove(bot.seat);
                  setEditing(null);
                }}
                aria-label={`Take ${bot.name} away`}
                className="px-2 text-sm font-semibold text-danger-soft disabled:opacity-40"
              >
                Remove
              </button>
              <Button variant="secondary" onClick={finish}>
                Done
              </Button>
            </div>
          </div>
        )}
        <button
          type="button"
          disabled={busy || full}
          onClick={onAdd}
          className="min-h-14 rounded-[16px] border border-dashed border-blue/50 px-5 text-[15px] font-semibold text-blue hover:bg-blue/5 disabled:opacity-40"
        >
          + Add computer
        </button>
      </div>
    </section>
  );
}

/** Changing your own card while you wait: the same player card as sitting down. */
function ChangeCard({
  player,
  busy,
  onSave,
  onClose,
}: {
  readonly player: RoomPlayerInfo | undefined;
  readonly busy: boolean;
  readonly onSave: (card: { name: string; avatar: ReturnType<typeof loadAvatar> }) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const [name, setName] = useState(player?.name ?? "");
  const [avatar, setAvatar] = useState(player?.avatar ?? loadAvatar());
  return (
    <Sheet title="Your player card" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name: name.trim(), avatar });
        }}
      >
        <PlayerCard
          name={name}
          onName={setName}
          avatar={avatar}
          onAvatar={setAvatar}
          account={loadAccount()}
          stats={null}
          editing
        />
        <Button type="submit" size="lg" disabled={busy || name.trim() === ""}>
          Save my card
        </Button>
      </form>
    </Sheet>
  );
}
