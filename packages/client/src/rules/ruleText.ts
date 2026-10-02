/**
 * A table's rules, as a player reads them: one line per rule, grouped the way the
 * editor groups them, each saying whether it was changed from the preset the
 * table started from and what the preset had.
 *
 * Pure, so the lobby and the editor read the same words and a test can pin them.
 * The comparison itself is `changedRules` from `@hf/shared`, the same one any
 * other screen would use; this only puts it into words.
 */
import {
  baseRules,
  changedRules,
  presetOf,
  type GameMode,
  type RulesConfig,
  type RulesPreset,
  type ScoringConfig,
  type TurnTimers,
} from "@hf/shared";

export const PRESET_NAMES: Readonly<Record<RulesPreset, string>> = {
  "east-coast": "East Coast",
  "west-coast": "West Coast",
};

export const MODE_NAMES: Readonly<Record<GameMode, string>> = {
  family: "Family",
  competitive: "Competitive",
};

export type RuleGroup = "Rounds" | "Melds and going out" | "The deal" | "Scoring" | "Time";

export const RULE_GROUPS: readonly RuleGroup[] = [
  "Rounds",
  "Melds and going out",
  "The deal",
  "Scoring",
  "Time",
];

export interface RuleLine {
  /** The rule's name as `changedRules` gives it: `rounds`, `scoring.joker`. */
  readonly id: string;
  readonly group: RuleGroup;
  readonly label: string;
  readonly value: string;
  /** What the preset has, when this table changed it. */
  readonly was: string | null;
}

/** A time in milliseconds as a player would say it: "45 s", "1 min 30 s", "3 min". */
export function formatTime(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

const onOff = (on: boolean): string => (on ? "On" : "Off");
const cardsOf = (n: number): string => `${n} card${n === 1 ? "" : "s"}`;
const points = (n: number): string => `${n < 0 ? "−" : ""}${Math.abs(n)}`;

interface Rule {
  readonly id: string;
  readonly group: RuleGroup;
  readonly label: string;
  readonly text: (config: RulesConfig) => string;
}

/** Each score's name, in the order both the editor and the lobby list them. */
export const SCORE_LABELS: readonly [keyof ScoringConfig, string][] = [
  ["joker", "Joker"],
  ["two", "Two"],
  ["ace", "Ace"],
  ["tenToKing", "Ten to king"],
  ["fourToNine", "Four to nine"],
  ["blackThree", "Black three"],
  ["redThree", "Red three"],
  ["cleanBookBonus", "Clean book bonus"],
  ["dirtyBookBonus", "Dirty book bonus"],
  ["goOutBonus", "Going out bonus"],
];

/** Each part of the turn clock's name. */
export const TIME_LABELS: readonly [keyof TurnTimers, string][] = [
  ["baseMs", "Time per turn"],
  ["incrementMs", "Added per move"],
  ["capMs", "Longest turn"],
  ["discardGraceMs", "Time to discard after"],
];

const RULES: readonly Rule[] = [
  { id: "rounds", group: "Rounds", label: "Rounds", text: (c) => String(c.rounds) },
  {
    id: "layDownMinimums",
    group: "Rounds",
    label: "Lay-down minimums",
    text: (c) => c.layDownMinimums.join(" · "),
  },
  {
    id: "wildRatio",
    group: "Melds and going out",
    label: "Wild cards in a meld",
    text: (c) =>
      c.wildRatio === "naturals-equal-wilds" ? "Up to as many as naturals" : "Fewer than naturals",
  },
  {
    id: "marvaRule",
    group: "Melds and going out",
    label: "Marva rule",
    text: (c) => onOff(c.marvaRule),
  },
  {
    id: "goOutCleanBooks",
    group: "Melds and going out",
    label: "Clean books to go out",
    text: (c) => String(c.goOutCleanBooks),
  },
  {
    id: "goOutDirtyBooks",
    group: "Melds and going out",
    label: "Dirty books to go out",
    text: (c) => String(c.goOutDirtyBooks),
  },
  { id: "handSize", group: "The deal", label: "Hand", text: (c) => cardsOf(c.handSize) },
  { id: "footSize", group: "The deal", label: "Foot", text: (c) => cardsOf(c.footSize) },
  {
    id: "extraDecks",
    group: "The deal",
    label: "Decks",
    text: (c) => `One per player${c.extraDecks === 0 ? "" : ` and ${c.extraDecks} more`}`,
  },
  {
    id: "initialDiscardFlip",
    group: "The deal",
    label: "First discard turned up",
    text: (c) => onOff(c.initialDiscardFlip),
  },
  {
    id: "stockExhaustion",
    group: "The deal",
    label: "When the stock runs out",
    text: (c) =>
      c.stockExhaustion === "end" ? "The round ends" : "The discard pile is reshuffled",
  },
  ...SCORE_LABELS.map(([key, label]): Rule => ({
    id: `scoring.${key}`,
    group: "Scoring",
    label,
    text: (c) => points(c.scoring[key]),
  })),
  ...TIME_LABELS.map(([key, label]): Rule => ({
    id: `timers.${key}`,
    group: "Time",
    label,
    text: (c) => formatTime(c.timers[key]),
  })),
  {
    id: "pauseEnabled",
    group: "Time",
    label: "Pausing allowed",
    text: (c) => (c.pauseEnabled ? "Yes" : "No"),
  },
];

/** Every rule of a table, in the editor's order, with what changed marked. */
export function ruleLines(config: RulesConfig): readonly RuleLine[] {
  const changed = changedRules(config);
  const base = baseRules(presetOf(config), config.mode);
  return RULES.map((rule) => ({
    id: rule.id,
    group: rule.group,
    label: rule.label,
    value: rule.text(config),
    was: changed.has(rule.id) ? rule.text(base) : null,
  }));
}

/** "East Coast · Family", the name a table's rules go by. */
export function rulesName(config: RulesConfig): string {
  return `${PRESET_NAMES[presetOf(config)]} · ${MODE_NAMES[config.mode]}`;
}
