/**
 * Practice: a table of you and computers, dealt at once. No code to share and no
 * waiting room, so the sheet holds everything New table does except the mode
 * (practice is always the family game, so it can be paused) and the seats left
 * for friends: a stepper sets how many computers, and each one's chip opens its
 * editor (name and level).
 *
 * "Deal me in" opens the table, seats the computers and deals in one go. Your
 * player card is a step only when this device has no name yet, since the table
 * needs one.
 */
import { useState, type FormEvent } from "react";
import { BOT_LEVELS, MAX_PLAYERS, resolveRules } from "@hf/shared";
import { draftRules, type RulesChoice } from "../rules/customRules";
import { AvatarFace } from "../profile/Avatar";
import { faceOf } from "../profile/avatarStore";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons";
import { Sheet } from "../ui/Sheet";
import { usePhone } from "../usePhone";
import {
  BotEditor,
  BotFace,
  CardStep,
  HouseRulesRow,
  HouseRulesStep,
  LEVEL_COLOR,
  LEVEL_WORDS,
  RoundsRow,
  RulesRefused,
  Stepper,
  TablePreview,
  VariantPicker,
  type CardInputs,
  type PlannedBot,
} from "./sheets";

const PRESET_WORDS = { "east-coast": "East Coast", "west-coast": "West Coast" } as const;

/** The fewest and most computers a practice table can have: one opponent, up to a full table. */
const PRACTICE_BOTS = { min: 1, max: MAX_PLAYERS - 1 } as const;

export function PracticeSheet({
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
  const [step, setStep] = useState<"setup" | "house" | "card">("setup");
  const [editing, setEditing] = useState<number | null>(null);
  const ok = resolveRules(choice).ok;
  const changes = Object.keys(choice.rules).length;
  const rounds = draftRules(choice).rounds;
  const named = card.name.trim() !== "";

  if (step === "card") {
    return (
      <Sheet id="practice" title="Your player card" onClose={onClose} wide={!phone}>
        <CardStep
          card={card}
          context={{
            verb: "Practice",
            what: `You and ${bots.length} computer${bots.length === 1 ? "" : "s"}`,
          }}
          action="Deal me in"
          disabled={busy || !ok}
          alert={alert}
          onSubmit={onSubmit}
          onBack={() => setStep("setup")}
        />
      </Sheet>
    );
  }

  if (step === "house") {
    return (
      <HouseRulesStep
        id="practice"
        choice={choice}
        onChoice={onChoice}
        onClose={onClose}
        onBack={() => setStep("setup")}
      />
    );
  }

  const count = (n: number): void => {
    onBots(
      n > bots.length
        ? [...bots, ...Array.from({ length: n - bots.length }, () => STANDARD)]
        : bots.slice(0, n),
    );
    if (editing !== null && editing >= n) setEditing(null);
  };

  const shown = (bot: PlannedBot, i: number): string => bot.name.trim() || `Computer ${i + 1}`;

  const computers = (
    <section aria-label="Computer players" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-xs font-semibold tracking-[0.06em] text-quiet uppercase">
          Computer players
        </h3>
        <Stepper
          label="Computer players"
          value={bots.length}
          min={PRACTICE_BOTS.min}
          max={PRACTICE_BOTS.max}
          onChange={count}
        />
      </div>
      <div className={`grid gap-2 ${phone ? "grid-cols-2" : "grid-cols-3"}`}>
        {bots.map((b, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Edit ${shown(b, i)}, ${LEVEL_WORDS[b.level]}`}
            aria-expanded={editing === i}
            onClick={() => setEditing(editing === i ? null : i)}
            className="flex min-h-[52px] min-w-0 items-center gap-2.5 rounded-[14px] border bg-[#1A1F24] px-2.5 py-1.5 text-left"
            style={{ borderColor: editing === i ? LEVEL_COLOR[b.level] : "rgba(255,255,255,0.08)" }}
          >
            <BotFace level={b.level} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{shown(b, i)}</span>
              <span className="block text-xs font-semibold" style={{ color: LEVEL_COLOR[b.level] }}>
                {LEVEL_WORDS[b.level]}
              </span>
            </span>
            <Icon name="pencil" size={14} className="shrink-0 text-muted" />
          </button>
        ))}
      </div>
      {editing !== null && (
        <BotEditor bots={bots} index={editing} onBots={onBots} onDone={() => setEditing(null)} />
      )}
      <p className="m-0 text-xs text-quiet">
        {phone ? "Tap" : "Click"} a computer to rename it or change how well it plays.
      </p>
    </section>
  );

  const deal = (
    <Button type="submit" size="lg" disabled={busy || !ok}>
      Deal me in
    </Button>
  );

  const you = <AvatarFace avatar={card.avatar ?? faceOf({ name: card.name || "?" })} size={34} />;

  const submit = (event: FormEvent): void => {
    // The table needs your name; without one, your card comes first.
    if (!named) {
      event.preventDefault();
      setStep("card");
      return;
    }
    onSubmit(event);
  };

  return (
    <Sheet id="practice" title="Practice" onClose={onClose} wide={phone ? false : "xl"}>
      <form onSubmit={submit} className="-mt-3 flex flex-col gap-5">
        {phone ? (
          <>
            <p className="m-0 text-[15px] text-muted">
              Just you and the computers. No code, no waiting.
            </p>
            <TablePreview bots={bots} you={you} exact />
            {computers}
            <VariantPicker choice={choice} onChoice={onChoice} />
            <RoundsRow choice={choice} onChoice={onChoice} />
            <HouseRulesRow changes={changes} onOpen={() => setStep("house")} />
            <RulesRefused choice={choice} />
            {/* Kept in view at the foot of the sheet, as the design pins it. */}
            <div className="sticky -bottom-7 -mx-5 -mb-7 flex flex-col gap-3 bg-sheet px-5 pt-3 pb-7">
              {alert}
              {deal}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-8">
            <div className="flex flex-col gap-6">
              <p className="m-0 text-base text-muted">
                Just you and the computers. No code, no waiting.
              </p>
              {computers}
              <VariantPicker choice={choice} onChoice={onChoice} />
              <div className="grid grid-cols-2 gap-3">
                <RoundsRow choice={choice} onChoice={onChoice} boxed />
                <HouseRulesRow changes={changes} onOpen={() => setStep("house")} />
              </div>
              <RulesRefused choice={choice} />
            </div>
            <div className="flex flex-col justify-center gap-4 border-l border-white/8 pl-8">
              <TablePreview bots={bots} you={you} exact />
              <p className="m-0 font-display text-xl font-semibold">
                You and {bots.length} computer{bots.length === 1 ? "" : "s"}
              </p>
              <LevelCounts bots={bots} />
              <p className="m-0 text-sm text-muted">
                {PRESET_WORDS[choice.preset]}, {rounds} round{rounds === 1 ? "" : "s"}
                {changes > 0 ? `, ${changes} house rule${changes === 1 ? "" : "s"} changed` : ""}.
                You can pause any time, and the game shows up in History like any other.
              </p>
              {alert}
              {deal}
            </div>
          </div>
        )}
      </form>
    </Sheet>
  );
}

const STANDARD: PlannedBot = { level: "standard", name: "" };

/** "2 Standard", "1 Hard": how many computers play at each level, in the level's color. */
function LevelCounts({ bots }: { readonly bots: readonly PlannedBot[] }): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      {BOT_LEVELS.map((level) => {
        const n = bots.filter((b) => b.level === level).length;
        if (n === 0) return null;
        return (
          <span
            key={level}
            className="rounded-full px-3 py-1 text-[13px] font-semibold"
            style={{ color: LEVEL_COLOR[level], background: `${LEVEL_COLOR[level]}22` }}
          >
            {n} {LEVEL_WORDS[level]}
          </span>
        );
      })}
    </div>
  );
}
