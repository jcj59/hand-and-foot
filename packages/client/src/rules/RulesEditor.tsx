/**
 * Changing a preset's rules before opening a table.
 *
 * Every rule the engine is configured by, grouped as the lobby lists them, each
 * marked when it differs from the preset and showing what the preset has. The
 * form asks `resolveRules` — the server's own check — as the player types, so the
 * reason a table would be refused is on screen before it is asked for; the server
 * asks again when it is, and its answer is the one that counts.
 */
import type { ReactNode } from "react";
import {
  baseRules,
  RULE_LIMITS,
  type RulesConfig,
  type ScoringConfig,
  type TurnTimers,
} from "@hf/shared";
import { draftRules, withDraft, withRounds, type RulesChoice } from "./customRules";
import { ruleLines, RULE_GROUPS, SCORE_LABELS, TIME_LABELS, type RuleGroup } from "./ruleText";

export interface RulesEditorProps {
  readonly choice: RulesChoice;
  readonly onChange: (choice: RulesChoice) => void;
}

export function RulesEditor({ choice, onChange }: RulesEditorProps): React.ReactElement {
  const draft = draftRules(choice);
  const preset = baseRules(choice.preset, choice.mode);
  const was = new Map(ruleLines(draft).map((line) => [line.id, line.was]));
  const set = (next: RulesConfig): void => onChange(withDraft(choice, next));
  const setScore = (key: keyof ScoringConfig, value: number): void =>
    set({ ...draft, scoring: { ...draft.scoring, [key]: value } });
  const setTime = (key: keyof TurnTimers, seconds: number): void =>
    set({ ...draft, timers: { ...draft.timers, [key]: seconds * 1000 } });

  const groups: Record<RuleGroup, ReactNode> = {
    Rounds: (
      <>
        <NumberRule
          label="Rounds"
          value={draft.rounds}
          {...RULE_LIMITS.rounds}
          was={was.get("rounds")}
          onChange={(n) => set(withRounds(draft, preset, n))}
        />
        <Row label="Lay-down minimums" was={was.get("layDownMinimums")}>
          <div className="flex flex-wrap justify-end gap-1">
            {draft.layDownMinimums.map((minimum, i) => (
              <NumberInput
                key={i}
                label={`Round ${i + 1} minimum`}
                value={minimum}
                {...RULE_LIMITS.layDownMinimum}
                step={5}
                onChange={(n) =>
                  set({
                    ...draft,
                    layDownMinimums: draft.layDownMinimums.map((m, j) => (j === i ? n : m)),
                  })
                }
              />
            ))}
          </div>
        </Row>
      </>
    ),
    "Melds and going out": (
      <>
        <Row label="Wild cards in a meld" was={was.get("wildRatio")}>
          <select
            aria-label="Wild cards in a meld"
            className={INPUT}
            value={draft.wildRatio}
            onChange={(e) =>
              set({ ...draft, wildRatio: e.target.value as RulesConfig["wildRatio"] })
            }
          >
            <option value="naturals-exceed-wilds">Fewer than naturals</option>
            <option value="naturals-equal-wilds">Up to as many as naturals</option>
          </select>
        </Row>
        <SwitchRule
          label="Marva rule"
          checked={draft.marvaRule}
          was={was.get("marvaRule")}
          onChange={(on) => set({ ...draft, marvaRule: on })}
        />
        <NumberRule
          label="Clean books to go out"
          value={draft.goOutCleanBooks}
          {...RULE_LIMITS.goOutBooks}
          was={was.get("goOutCleanBooks")}
          onChange={(n) => set({ ...draft, goOutCleanBooks: n })}
        />
        <NumberRule
          label="Dirty books to go out"
          value={draft.goOutDirtyBooks}
          {...RULE_LIMITS.goOutBooks}
          was={was.get("goOutDirtyBooks")}
          onChange={(n) => set({ ...draft, goOutDirtyBooks: n })}
        />
      </>
    ),
    "The deal": (
      <>
        <NumberRule
          label="Hand"
          unit="cards"
          value={draft.handSize}
          {...RULE_LIMITS.handSize}
          was={was.get("handSize")}
          onChange={(n) => set({ ...draft, handSize: n })}
        />
        <NumberRule
          label="Foot"
          unit="cards"
          value={draft.footSize}
          {...RULE_LIMITS.footSize}
          was={was.get("footSize")}
          onChange={(n) => set({ ...draft, footSize: n })}
        />
        <NumberRule
          label="Extra decks"
          unit="beyond one each"
          value={draft.extraDecks}
          {...RULE_LIMITS.extraDecks}
          was={was.get("extraDecks")}
          onChange={(n) => set({ ...draft, extraDecks: n })}
        />
        <SwitchRule
          label="First discard turned up"
          checked={draft.initialDiscardFlip}
          was={was.get("initialDiscardFlip")}
          onChange={(on) => set({ ...draft, initialDiscardFlip: on })}
        />
        <Row label="When the stock runs out" was={was.get("stockExhaustion")}>
          <select
            aria-label="When the stock runs out"
            className={INPUT}
            value={draft.stockExhaustion}
            onChange={(e) =>
              set({ ...draft, stockExhaustion: e.target.value as RulesConfig["stockExhaustion"] })
            }
          >
            <option value="reshuffle">Reshuffle the pile</option>
            <option value="end">The round ends</option>
          </select>
        </Row>
      </>
    ),
    Scoring: (
      <>
        {SCORE_LABELS.map(([key, label]) => (
          <NumberRule
            key={key}
            label={label}
            value={draft.scoring[key]}
            {...(key === "redThree"
              ? RULE_LIMITS.redThree
              : key.endsWith("Bonus")
                ? RULE_LIMITS.bonus
                : RULE_LIMITS.cardValue)}
            step={5}
            was={was.get(`scoring.${key}`)}
            onChange={(n) => setScore(key, n)}
          />
        ))}
      </>
    ),
    Time: (
      <>
        {TIME_LABELS.map(([key, label]) => (
          <NumberRule
            key={key}
            label={label}
            unit="seconds"
            value={draft.timers[key] / 1000}
            min={RULE_LIMITS[key].min / 1000}
            max={RULE_LIMITS[key].max / 1000}
            was={was.get(`timers.${key}`)}
            onChange={(n) => setTime(key, n)}
          />
        ))}
        <SwitchRule
          label="Pausing allowed"
          checked={draft.pauseEnabled}
          was={was.get("pauseEnabled")}
          onChange={(on) => set({ ...draft, pauseEnabled: on })}
        />
      </>
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      {RULE_GROUPS.map((group) => (
        <fieldset key={group} className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold tracking-wide text-white/50 uppercase">
            {group}
          </legend>
          {groups[group]}
        </fieldset>
      ))}
    </div>
  );
}

const INPUT =
  "rounded border border-white/20 bg-black/30 px-2 py-1 text-sm text-white disabled:opacity-40";

/** One rule: its name, the control, and — when changed — what the preset has. */
function Row({
  label,
  was,
  children,
}: {
  readonly label: string;
  readonly was: string | null | undefined;
  readonly children: ReactNode;
}): React.ReactElement {
  const changed = was !== null && was !== undefined;
  return (
    <div
      data-changed={changed || undefined}
      className={`flex items-center justify-between gap-3 rounded px-2 py-1 text-sm ${
        changed ? "bg-amber-300/10 ring-1 ring-amber-300/50" : ""
      }`}
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-white/80">{label}</span>
        {changed && <span className="text-xs text-amber-200/80">Preset: {was}</span>}
      </span>
      {children}
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      className={`${INPUT} w-20 text-right`}
      // A half-typed value is NaN until it is a number; shown empty, refused by the check.
      value={Number.isNaN(value) ? "" : value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
    />
  );
}

function NumberRule(props: {
  readonly label: string;
  readonly unit?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly was: string | null | undefined;
  readonly onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <Row label={props.label} was={props.was}>
      <span className="flex items-center gap-1.5">
        <NumberInput {...props} />
        {props.unit && <span className="text-xs text-white/50">{props.unit}</span>}
      </span>
    </Row>
  );
}

function SwitchRule({
  label,
  checked,
  was,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly was: string | null | undefined;
  readonly onChange: (on: boolean) => void;
}): React.ReactElement {
  return (
    <Row label={label} was={was}>
      <input
        type="checkbox"
        aria-label={label}
        className="h-4 w-4 accent-amber-300"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Row>
  );
}
