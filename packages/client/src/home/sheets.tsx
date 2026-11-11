/**
 * The two ways into a game from the home screen, each a sheet over it:
 *
 * - Join a table: the code (six boxes, or a QR code read by the camera), then your
 *   player card, then Take a seat.
 * - New table: the table's rules and any computer players, then your player card,
 *   then Open table.
 *
 * Both end on the same player card (`PlayerCard`), since both end with you sitting
 * down. The home screen owns the name, the face and the request; these sheets are
 * the steps in between.
 */
import { useState, type FormEvent } from "react";
import {
  BOT_LEVELS,
  MAX_BOT_NAME_LENGTH,
  MAX_PLAYERS,
  RULE_LIMITS,
  baseRules,
  resolveRules,
  type BotLevel,
  type BotSettings,
} from "@hf/shared";
import { CodeBoxes } from "../join/CodeBoxes";
import { Scanner } from "../join/Scanner";
import { CardNote, PlayerCard, type PlayerCardProps } from "../profile/PlayerCard";
import { isPossibleRoomCode } from "../roomCode";
import {
  DEFAULT_CHOICE,
  draftRules,
  rebased,
  withDraft,
  withRounds,
  type RulesChoice,
} from "../rules/customRules";
import { RulesEditor } from "../rules/RulesEditor";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { IconBox } from "../ui/IconBox";
import { Icon } from "../ui/icons";
import { Segmented } from "../ui/Segmented";
import { Sheet } from "../ui/Sheet";
import { usePhone } from "../usePhone";

/** What the card step needs from the home screen: the card itself and its stats. */
export type CardInputs = Omit<PlayerCardProps, "editing">;

/** One computer player as the host has set it up, before the table exists. */
export interface PlannedBot {
  readonly level: BotLevel;
  /** Blank for "any": the server hands out a name. */
  readonly name: string;
}

/** Names to suggest for a computer player, handed out in turn. */
export const BOT_NAME_IDEAS = [
  "Shuffles",
  "Card Shark",
  "Lady Luck",
  "Deal Bot",
  "Wild Thing",
  "Pile Driver",
  "Book Worm",
  "Sir Melds-a-Lot",
] as const;

/** The next suggestion for a computer's name, skipping any already taken. */
export function suggestBotName(current: string, taken: readonly string[]): string {
  const free = BOT_NAME_IDEAS.filter((n) => n === current || !taken.includes(n));
  const at = free.indexOf(current as (typeof BOT_NAME_IDEAS)[number]);
  return free[(at + 1) % free.length] ?? BOT_NAME_IDEAS[0];
}

export const LEVEL_WORDS: Record<BotLevel, string> = {
  easy: "Easy",
  standard: "Standard",
  hard: "Hard",
};

/** Each level's color, as the design gives it: teal, blue, orange. */
export const LEVEL_COLOR: Record<BotLevel, string> = {
  easy: "#7CD9C0",
  standard: "#8FB8E8",
  hard: "#F59E5B",
};

/**
 * The player card, with what you are sitting down at and the button that does it.
 * A device signed in starts on the finished card; anyone else starts editing it.
 */
export function CardStep({
  card,
  context,
  action,
  disabled,
  alert,
  onSubmit,
  onBack,
}: {
  readonly card: CardInputs;
  /** "Joining table K7QM2P", "Opening East Coast · Family". */
  readonly context: { readonly verb: string; readonly what: React.ReactNode };
  /** The button's words when editing; signed in it says who you sit down as. */
  readonly action: string;
  readonly disabled: boolean;
  readonly alert: React.ReactNode;
  readonly onSubmit: (event: FormEvent) => void;
  readonly onBack: () => void;
}): React.ReactElement {
  const phone = usePhone();
  const [editing, setEditing] = useState(card.account === null);
  const named = card.name.trim() !== "";
  const label = !editing && named ? `Sit down as ${card.name.trim()}` : action;
  const header = (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex size-11 shrink-0 items-center justify-center rounded-[14px] border border-white/10 bg-surface hover:bg-raised"
      >
        <Icon name="back" size={18} />
      </button>
      <span className="min-w-0">
        <span className="block text-sm text-muted">{context.verb}</span>
        <span className="block truncate font-display text-lg font-semibold">{context.what}</span>
      </span>
    </div>
  );
  const buttons = (
    <>
      {alert}
      <Button type="submit" size="lg" disabled={disabled || !named}>
        {label}
      </Button>
      {!editing && (
        <Button size="lg" variant="secondary" onClick={() => setEditing(true)}>
          Change picture or name
        </Button>
      )}
      <CardNote account={card.account} />
    </>
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {phone ? (
        <>
          {header}
          <PlayerCard {...card} editing={editing} />
          {buttons}
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] gap-8">
          <PlayerCard {...card} editing={editing} />
          <div className="flex flex-col justify-center gap-4 border-l border-white/8 pl-8">
            {header}
            {buttons}
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Joining a table: the code first, in six boxes (or read from the table's QR
 * code), then your player card. On a computer the camera sits beside the boxes;
 * on a phone, scanning takes the whole screen.
 */
export function JoinSheet({
  code,
  onCode,
  startWithCode,
  card,
  alert,
  busy,
  onSubmit,
  onClose,
}: {
  readonly code: string;
  readonly onCode: (code: string) => void;
  readonly startWithCode: boolean;
  readonly card: CardInputs;
  readonly alert: React.ReactNode;
  readonly busy: boolean;
  readonly onSubmit: (event: FormEvent) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const phone = usePhone();
  const [step, setStep] = useState<"code" | "card">(
    startWithCode && isPossibleRoomCode(code) ? "card" : "code",
  );
  const [scanning, setScanning] = useState(false);
  const read = (found: string): void => {
    onCode(found);
    setScanning(false);
    setStep("card");
  };

  if (phone && scanning) {
    return (
      <Sheet id="join" title="Scan the table's QR code" onClose={() => setScanning(false)}>
        <Scanner onCode={read} autoStart />
        <Button variant="secondary" size="lg" onClick={() => setScanning(false)}>
          Type the code instead
        </Button>
      </Sheet>
    );
  }

  if (step === "card") {
    return (
      <Sheet id="join" title="Your player card" onClose={onClose} wide={!phone}>
        <CardStep
          card={card}
          context={{
            verb: "Joining",
            what: (
              <>
                Table <span className="font-mono text-accent">{code}</span>
              </>
            ),
          }}
          action="Take a seat"
          disabled={busy || !isPossibleRoomCode(code)}
          alert={alert}
          onSubmit={onSubmit}
          onBack={() => setStep("code")}
        />
      </Sheet>
    );
  }

  const codeStep = (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPossibleRoomCode(code)) setStep("card");
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

  return (
    <Sheet id="join" title="Join a table" onClose={onClose} wide={!phone}>
      {phone ? (
        codeStep
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-8">
          {codeStep}
          <div className="flex flex-col items-center gap-3 border-l border-white/8 pl-8">
            <h3 className="m-0 text-center font-display text-lg font-semibold">
              Or scan the table&rsquo;s QR code
            </h3>
            <Scanner onCode={read} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

const PRESET_WORDS = { "east-coast": "East Coast", "west-coast": "West Coast" } as const;
const MODE_WORDS = { family: "Family", competitive: "Competitive" } as const;

/**
 * Opening a table: its variant, mode and rounds, the house rules folded behind a
 * row of their own, and computer players (each with a name and a level), then
 * your player card.
 */
export function NewTableSheet({
  choice,
  onChoice,
  bots,
  onBots,
  card,
  alert,
  busy,
  onSubmit,
  onClose,
}: {
  readonly choice: RulesChoice;
  readonly onChoice: (choice: RulesChoice) => void;
  readonly bots: readonly PlannedBot[];
  readonly onBots: (bots: readonly PlannedBot[]) => void;
  readonly card: CardInputs;
  readonly alert: React.ReactNode;
  readonly busy: boolean;
  readonly onSubmit: (event: FormEvent) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const phone = usePhone();
  const [step, setStep] = useState<"rules" | "house" | "card">("rules");
  const { preset, mode } = choice;
  // The server's own check, asked as the rules are edited; the server asks again.
  const checked = resolveRules(choice);
  const changes = Object.keys(choice.rules).length;
  const summary = `${PRESET_WORDS[preset]} · ${MODE_WORDS[mode]}`;
  const draft = draftRules(choice);

  if (step === "card") {
    return (
      <Sheet id="new" title="Your player card" onClose={onClose} wide={!phone}>
        <CardStep
          card={card}
          context={{ verb: "Opening a table", what: summary }}
          action="Open table"
          disabled={busy || !checked.ok}
          alert={alert}
          onSubmit={onSubmit}
          onBack={() => setStep("rules")}
        />
      </Sheet>
    );
  }

  if (step === "house") {
    return (
      <HouseRulesStep
        id="new"
        choice={choice}
        onChoice={onChoice}
        onClose={onClose}
        onBack={() => setStep("rules")}
      />
    );
  }

  const settings = (
    <div className="flex flex-col gap-5">
      <VariantPicker choice={choice} onChoice={onChoice} />
      <Segmented
        label="Mode"
        value={mode}
        onChange={(m) => onChoice(rebased(choice, preset, m))}
        options={[
          { value: "family", label: "Family", detail: "Pause any time" },
          { value: "competitive", label: "Competitive", detail: "Strict turn clock" },
        ]}
      />
      <RoundsRow choice={choice} onChoice={onChoice} />
      <HouseRulesRow changes={changes} onOpen={() => setStep("house")} />
      <RulesRefused choice={choice} />
      <ComputerPlayers bots={bots} onBots={onBots} />
    </div>
  );

  const next = (
    <Button size="lg" disabled={!checked.ok} onClick={() => setStep("card")}>
      Open table
    </Button>
  );

  return (
    <Sheet id="new" title="New table" onClose={onClose} wide={!phone}>
      {phone ? (
        <>
          <TablePreview bots={bots} />
          {settings}
          {alert}
          {next}
        </>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-8">
          {settings}
          <div className="flex flex-col gap-4 border-l border-white/8 pl-8">
            <p className="m-0 text-xs font-semibold tracking-[0.06em] text-quiet uppercase">
              You&rsquo;re opening
            </p>
            <TablePreview bots={bots} />
            <p className="m-0 font-display text-xl font-semibold">{summary}</p>
            <p className="m-0 text-sm text-muted">
              {draft.rounds} round{draft.rounds === 1 ? "" : "s"}
              {changes > 0 ? ` · ${changes} house rule${changes === 1 ? "" : "s"} changed` : ""}.
              You&rsquo;ll get a six-letter code to share.
            </p>
            {alert}
            {next}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The house rules, on a step of their own, with the way back to the sheet. */
export function HouseRulesStep({
  id,
  choice,
  onChoice,
  onClose,
  onBack,
}: {
  readonly id: string;
  readonly choice: RulesChoice;
  readonly onChoice: (choice: RulesChoice) => void;
  readonly onClose: () => void;
  readonly onBack: () => void;
}): React.ReactElement {
  const changes = Object.keys(choice.rules).length;
  return (
    <Sheet id={id} title="House rules" onClose={onClose}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted hover:text-ink"
        >
          <Icon name="back" size={16} />
          Back to the table
        </button>
        {changes > 0 && <Chip tone="gold">{changes} changed</Chip>}
      </div>
      <RulesEditor choice={choice} onChange={onChoice} />
      {changes > 0 && (
        <button
          type="button"
          onClick={() => onChoice({ ...DEFAULT_CHOICE, preset: choice.preset, mode: choice.mode })}
          className="self-start text-xs text-muted underline"
        >
          Back to the preset&rsquo;s rules
        </button>
      )}
      <RulesRefused choice={choice} />
    </Sheet>
  );
}

/** East Coast or West Coast, keeping any house rules changed. */
export function VariantPicker({
  choice,
  onChoice,
}: {
  readonly choice: RulesChoice;
  readonly onChoice: (choice: RulesChoice) => void;
}): React.ReactElement {
  return (
    <Segmented
      label="Variant"
      value={choice.preset}
      onChange={(p) => onChoice(rebased(choice, p, choice.mode))}
      options={[
        { value: "east-coast", label: "East Coast", detail: "Naturals beat wilds" },
        { value: "west-coast", label: "West Coast", detail: "Wilds can match" },
      ]}
    />
  );
}

/** How many rounds, with a minimum for each as the count changes. */
export function RoundsRow({
  choice,
  onChoice,
  boxed = false,
}: {
  readonly choice: RulesChoice;
  readonly onChoice: (choice: RulesChoice) => void;
  /** In a box of its own, as Practice sets it beside the house rules on a computer. */
  readonly boxed?: boolean;
}): React.ReactElement {
  const draft = draftRules(choice);
  return (
    <div
      className={`flex items-center justify-between gap-3 ${
        boxed ? "rounded-[14px] border border-white/8 bg-[#1A1F24] py-2 pr-2 pl-4" : ""
      }`}
    >
      <span>
        <span className="block text-[15px] font-semibold">Rounds</span>
        <span className="block text-xs whitespace-nowrap text-quiet">About 25 min each</span>
      </span>
      <Stepper
        label="Rounds"
        value={draft.rounds}
        min={RULE_LIMITS.rounds.min}
        max={RULE_LIMITS.rounds.max}
        onChange={(n) =>
          onChoice(withDraft(choice, withRounds(draft, baseRules(choice.preset, choice.mode), n)))
        }
      />
    </div>
  );
}

/** The row that opens the house rules, with how many are changed. */
export function HouseRulesRow({
  changes,
  onOpen,
}: {
  readonly changes: number;
  readonly onOpen: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-[#1A1F24] px-4 py-2 text-left hover:border-white/15"
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">House rules</span>
        <span className="block truncate text-xs text-quiet">
          Red 3s, meld minimums, wild cards…
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {changes > 0 && <Chip tone="gold">{changes} changed</Chip>}
        <Icon name="forward" size={18} className="text-muted" />
      </span>
    </button>
  );
}

/** Why the server would refuse these rules, asked as they are edited; null when it would not. */
export function RulesRefused({
  choice,
}: {
  readonly choice: RulesChoice;
}): React.ReactElement | null {
  const checked = resolveRules(choice);
  if (checked.ok) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">
      {capitalize(checked.error)}.
    </p>
  );
}

/** A number with − and + beside it, as the design sets the rounds. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (n: number) => void;
}): React.ReactElement {
  const step =
    "flex size-11 items-center justify-center rounded-[10px] bg-raised text-xl font-semibold disabled:opacity-30";
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1 rounded-[14px] bg-page p-1"
    >
      <button
        type="button"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className={step}
      >
        −
      </button>
      <output className="w-9 text-center font-display text-lg font-bold">{value}</output>
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className={step}
      >
        +
      </button>
    </div>
  );
}

/** A computer's face: two eyes on its level's color, as the design draws them. */
export function BotFace({
  level,
  size,
}: {
  readonly level: BotLevel;
  readonly size: number;
}): React.ReactElement {
  const ink = "#0B2340";
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 20 20" className="shrink-0">
      <circle cx="10" cy="10" r="10" fill={LEVEL_COLOR[level]} />
      <circle cx="7" cy="9" r="1.6" fill={ink} />
      <circle cx="13" cy="9" r="1.6" fill={ink} />
    </svg>
  );
}

/**
 * The oval table with your seat and the others round it: empty, or a computer's.
 * New table always shows room for four or more, the empty ones to be filled by
 * friends; Practice shows exactly the seats it will deal to.
 */
export function TablePreview({
  bots,
  you,
  exact = false,
}: {
  readonly bots: readonly PlannedBot[];
  /** Your own face, when known; a plain seat otherwise. */
  readonly you?: React.ReactNode;
  readonly exact?: boolean;
}): React.ReactElement {
  const total = exact ? bots.length + 1 : Math.max(4, bots.length + 2);
  return (
    <div aria-hidden="true" className="relative mx-auto h-[150px] w-full max-w-[330px]">
      <div
        className="absolute inset-x-[16%] inset-y-[22%] rounded-[80px]"
        style={{
          background: "radial-gradient(ellipse at 50% 40%, #2C6B53, #1A4535 70%, #143629)",
          boxShadow: "inset 0 0 0 6px #3A2A1C, inset 0 0 0 7px #5A4330",
        }}
      />
      {Array.from({ length: total }, (_, i) => {
        const a = Math.PI / 2 + (2 * Math.PI * i) / total;
        const left = 50 + 42 * Math.cos(a);
        const top = 50 + 40 * Math.sin(a);
        const bot = i > 0 ? bots[i - 1] : undefined;
        return (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            {i === 0 ? (
              you ? (
                <span className="flex rounded-full border-[3px] border-accent">{you}</span>
              ) : (
                <span className="flex size-10 items-center justify-center rounded-full border-[3px] border-accent bg-coral" />
              )
            ) : bot ? (
              <BotFace level={bot.level} size={32} />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-full border-2 border-dashed border-accent/60 text-xs text-accent">
                +
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The computers to seat once the table opens: a chip each, and an editor for one. */
function ComputerPlayers({
  bots,
  onBots,
}: {
  readonly bots: readonly PlannedBot[];
  readonly onBots: (bots: readonly PlannedBot[]) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState<number | null>(null);
  const shown = (bot: PlannedBot, i: number): string => bot.name.trim() || `Computer ${i + 1}`;
  const room = bots.length < MAX_PLAYERS - 1;
  const bot = editing === null ? undefined : bots[editing];
  return (
    <section aria-label="Computer players" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-xs font-semibold tracking-[0.06em] text-quiet uppercase">
          Computer players
        </h3>
        {bots.length === 0 && (
          <span className="text-xs text-quiet">None yet, friends fill the seats</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {bots.map((b, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Edit ${shown(b, i)}, ${LEVEL_WORDS[b.level]}`}
            aria-expanded={editing === i}
            onClick={() => setEditing(editing === i ? null : i)}
            className="flex min-h-12 items-center gap-2 rounded-[14px] border bg-[#1A1F24] pr-3 pl-2 text-left"
            style={{ borderColor: editing === i ? LEVEL_COLOR[b.level] : "rgba(255,255,255,0.08)" }}
          >
            <BotFace level={b.level} size={26} />
            <span>
              <span className="block text-sm font-semibold">{shown(b, i)}</span>
              <span
                className="block text-[11px] font-semibold"
                style={{ color: LEVEL_COLOR[b.level] }}
              >
                {LEVEL_WORDS[b.level]}
              </span>
            </span>
          </button>
        ))}
        {room && (
          <button
            type="button"
            onClick={() => {
              onBots([...bots, { level: "standard", name: "" }]);
              setEditing(bots.length);
            }}
            className="min-h-12 rounded-[14px] border border-dashed border-blue/50 px-4 text-sm font-semibold text-blue hover:bg-blue/5"
          >
            + Add computer
          </button>
        )}
      </div>
      {bot && editing !== null && (
        <BotEditor
          bots={bots}
          index={editing}
          onBots={onBots}
          onDone={() => setEditing(null)}
          removable
        />
      )}
    </section>
  );
}

/**
 * One planned computer's editor: its name (or a suggested one), how well it plays,
 * and, where the sheet allows it, taking it away.
 */
export function BotEditor({
  bots,
  index,
  onBots,
  onDone,
  removable = false,
}: {
  readonly bots: readonly PlannedBot[];
  readonly index: number;
  readonly onBots: (bots: readonly PlannedBot[]) => void;
  readonly onDone: () => void;
  readonly removable?: boolean;
}): React.ReactElement | null {
  const bot = bots[index];
  if (!bot) return null;
  const set = (change: Partial<PlannedBot>): void =>
    onBots(bots.map((b, j) => (j === index ? { ...b, ...change } : b)));
  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-white/10 bg-surface p-4">
      <div className="flex items-center gap-3">
        <BotFace level={bot.level} size={40} />
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-quiet">Name</span>
          <input
            value={bot.name}
            placeholder={`Computer ${index + 1}`}
            maxLength={MAX_BOT_NAME_LENGTH}
            onChange={(e) => set({ name: e.target.value })}
            className="min-h-10 rounded-xl border border-white/12 bg-page px-3 text-ink placeholder:text-faint"
          />
        </label>
        <button
          type="button"
          onClick={() =>
            set({
              name: suggestBotName(
                bot.name,
                bots.map((b) => b.name),
              ),
            })
          }
          className="self-end rounded-xl border border-white/12 px-3 py-2 text-xs text-ink-soft hover:bg-white/5"
        >
          Suggest a name
        </button>
      </div>
      <div
        role="radiogroup"
        aria-label="How hard"
        className="grid grid-cols-3 gap-1 rounded-xl bg-page p-1"
      >
        {BOT_LEVELS.map((level) => {
          const on = bot.level === level;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ level })}
              className="min-h-[38px] rounded-[9px] text-[13px] font-semibold"
              style={
                on ? { background: LEVEL_COLOR[level], color: "#0B2340" } : { color: "#9AA3AD" }
              }
            >
              {LEVEL_WORDS[level]}
            </button>
          );
        })}
      </div>
      <div className={`flex gap-2 ${removable ? "justify-between" : "justify-end"}`}>
        {removable && (
          <Button
            variant="danger"
            onClick={() => {
              onBots(bots.filter((_, j) => j !== index));
              onDone();
            }}
          >
            Remove
          </Button>
        )}
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** A planned computer as the server is asked for it: a blank name means any. */
export function botSettings(bot: PlannedBot): BotSettings {
  const name = bot.name.trim();
  return name ? { level: bot.level, name } : { level: bot.level };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
