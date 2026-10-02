// A table's rules: the presets it starts from, the changes its creator may make,
// and the one check that decides whether a set of changes is a game worth dealing.
//
// The check lives here rather than in the server because the rules editor asks
// the same question as the player types, and two copies of a validator are two
// answers. The server is still the authority — it runs this on whatever arrives,
// and a form that has been bypassed gets the same refusal a careless one shows.

import type { GameMode, RulesConfig, ScoringConfig, TurnTimers } from "./index";
import type { Ack } from "./protocol";

/** The named rule sets a table starts from. */
export type RulesPreset = "east-coast" | "west-coast";

/** East Coast preset (default): naturals must strictly outnumber wilds; Family-paced. */
export const EAST_COAST: RulesConfig = {
  rounds: 4,
  layDownMinimums: [60, 90, 120, 150],
  wildRatio: "naturals-exceed-wilds",
  marvaRule: true,
  goOutCleanBooks: 1,
  goOutDirtyBooks: 2,
  handSize: 14,
  footSize: 14,
  extraDecks: 1,
  initialDiscardFlip: true,
  stockExhaustion: "reshuffle",
  scoring: {
    joker: 50,
    two: 20,
    ace: 15,
    tenToKing: 10,
    fourToNine: 5,
    blackThree: 5,
    redThree: -500,
    cleanBookBonus: 500,
    dirtyBookBonus: 300,
    goOutBonus: 100,
  },
  mode: "family",
  pauseEnabled: true,
  timers: { baseMs: 90_000, incrementMs: 10_000, capMs: 180_000, discardGraceMs: 20_000 },
  preset: "east-coast",
};

/**
 * West Coast preset: wilds may equal naturals. Otherwise identical for now — the
 * Marva rule included, which both coasts play.
 */
export const WEST_COAST: RulesConfig = {
  ...EAST_COAST,
  wildRatio: "naturals-equal-wilds",
  preset: "west-coast",
};

export const PRESETS: Readonly<Record<RulesPreset, RulesConfig>> = {
  "east-coast": EAST_COAST,
  "west-coast": WEST_COAST,
};

/**
 * Changes to a preset's rules, any subset of them. Scoring and the turn clock
 * may be changed one value at a time. `mode` and `preset` are not here: they are
 * chosen beside the overrides, and they are what the overrides are relative to.
 */
export type RulesOverrides = {
  readonly [
    K in Exclude<keyof RulesConfig, "mode" | "preset" | "scoring" | "timers">
  ]?: RulesConfig[K];
} & {
  readonly scoring?: Partial<ScoringConfig>;
  readonly timers?: Partial<TurnTimers>;
};

/** What the room creator chooses when opening a table. Everything is optional. */
export interface RoomOptions {
  readonly preset?: RulesPreset;
  readonly mode?: GameMode;
  readonly rules?: RulesOverrides;
}

interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * How far each rule may be taken. Wide enough for any house variant anyone has
 * asked about, narrow enough that a table cannot be opened into something that
 * never ends or never starts: a turn of a few seconds, a minimum nobody can make,
 * a deal larger than the decks.
 */
export const RULE_LIMITS = {
  rounds: { min: 1, max: 8 },
  layDownMinimum: { min: 0, max: 500 },
  goOutBooks: { min: 0, max: 5 },
  handSize: { min: 5, max: 20 },
  footSize: { min: 5, max: 20 },
  extraDecks: { min: 0, max: 4 },
  /** Face values of melded cards; never negative, since the lay-down search spends the highest first. */
  cardValue: { min: 0, max: 500 },
  /** A red three is a penalty, so at most worth nothing. */
  redThree: { min: -1000, max: 0 },
  bonus: { min: 0, max: 2000 },
  baseMs: { min: 10_000, max: 600_000 },
  incrementMs: { min: 0, max: 60_000 },
  capMs: { min: 10_000, max: 1_800_000 },
  discardGraceMs: { min: 5_000, max: 120_000 },
} as const satisfies Record<string, Range>;

/**
 * The rules a preset and mode give before any change: the comparison a table's
 * rules are shown against. Competitive is the mode in which the clock cannot be
 * stopped, so choosing it turns pausing off.
 */
export function baseRules(preset: RulesPreset = "east-coast", mode?: GameMode): RulesConfig {
  const rules = PRESETS[preset];
  if (mode === undefined) return rules;
  return { ...rules, mode, pauseEnabled: mode === "family" };
}

/**
 * Which preset a table's rules started from. Tables opened before the rules
 * editor did not record it; for those the wild ratio is the only thing that ever
 * told the presets apart, so it still does.
 */
export function presetOf(config: RulesConfig): RulesPreset {
  if (config.preset) return config.preset;
  return config.wildRatio === WEST_COAST.wildRatio ? "west-coast" : "east-coast";
}

type Check = string | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Something that is not a number at all is not an integer either: one check covers both. */
function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

/** A whole number within the range, or the reason it is not, naming the rule. */
function whole(value: unknown, label: string, range: Range): Check {
  if (!isInteger(value)) {
    return `${label} must be a whole number`;
  }
  if (value < range.min || value > range.max) {
    return `${label} must be between ${range.min} and ${range.max}`;
  }
  return null;
}

/** A time in milliseconds, which players set — and read about — in whole seconds. */
function seconds(value: unknown, label: string, range: Range): Check {
  if (!isInteger(value) || value % 1000 !== 0) {
    return `${label} must be a whole number of seconds`;
  }
  if (value < range.min || value > range.max) {
    return `${label} must be between ${range.min / 1000} and ${range.max / 1000} seconds`;
  }
  return null;
}

function flag(value: unknown, label: string): Check {
  return typeof value === "boolean" ? null : `${label} must be on or off`;
}

function oneOf(value: unknown, label: string, allowed: readonly string[]): Check {
  return allowed.includes(value as string) ? null : `${label} must be ${allowed.join(" or ")}`;
}

const SCORING_CHECKS: Readonly<Record<keyof ScoringConfig, (v: unknown) => Check>> = {
  joker: (v) => whole(v, "a joker's value", RULE_LIMITS.cardValue),
  two: (v) => whole(v, "a two's value", RULE_LIMITS.cardValue),
  ace: (v) => whole(v, "an ace's value", RULE_LIMITS.cardValue),
  tenToKing: (v) => whole(v, "the value of a ten to king", RULE_LIMITS.cardValue),
  fourToNine: (v) => whole(v, "the value of a four to nine", RULE_LIMITS.cardValue),
  blackThree: (v) => whole(v, "a black three's value", RULE_LIMITS.cardValue),
  redThree: (v) => whole(v, "a red three's value", RULE_LIMITS.redThree),
  cleanBookBonus: (v) => whole(v, "the clean book bonus", RULE_LIMITS.bonus),
  dirtyBookBonus: (v) => whole(v, "the dirty book bonus", RULE_LIMITS.bonus),
  goOutBonus: (v) => whole(v, "the going out bonus", RULE_LIMITS.bonus),
};

const TIMER_CHECKS: Readonly<Record<keyof TurnTimers, (v: unknown) => Check>> = {
  baseMs: (v) => seconds(v, "the time per turn", RULE_LIMITS.baseMs),
  incrementMs: (v) => seconds(v, "the time added per move", RULE_LIMITS.incrementMs),
  capMs: (v) => seconds(v, "the longest a turn may last", RULE_LIMITS.capMs),
  discardGraceMs: (v) => seconds(v, "the time to discard", RULE_LIMITS.discardGraceMs),
};

/** Every field of a nested group, each checked; unknown names are refused. */
function group(
  value: unknown,
  label: string,
  checks: Readonly<Record<string, (v: unknown) => Check>>,
): Check {
  if (!isPlainObject(value)) return `the ${label} were not understood`;
  for (const [key, field] of Object.entries(value)) {
    if (!Object.hasOwn(checks, key))
      return `there is no ${label.replace(/s$/, "")} called "${key}"`;
    const problem = checks[key]!(field);
    if (problem) return problem;
  }
  return null;
}

/** Checks on the top-level overrides, one per rule a creator may change. */
const RULE_CHECKS: Readonly<Record<keyof RulesOverrides, (v: unknown) => Check>> = {
  rounds: (v) => whole(v, "the number of rounds", RULE_LIMITS.rounds),
  layDownMinimums: (v) => {
    if (!Array.isArray(v)) return "the lay-down minimums must be a list, one for each round";
    if (v.length > RULE_LIMITS.rounds.max) return "there are more lay-down minimums than rounds";
    for (const [i, minimum] of v.entries()) {
      const problem = whole(minimum, `the round ${i + 1} minimum`, RULE_LIMITS.layDownMinimum);
      if (problem) return problem;
    }
    return null;
  },
  wildRatio: (v) =>
    oneOf(v, "the wild card rule", ["naturals-exceed-wilds", "naturals-equal-wilds"]),
  marvaRule: (v) => flag(v, "the Marva rule"),
  goOutCleanBooks: (v) => whole(v, "the clean books needed to go out", RULE_LIMITS.goOutBooks),
  goOutDirtyBooks: (v) => whole(v, "the dirty books needed to go out", RULE_LIMITS.goOutBooks),
  handSize: (v) => whole(v, "the hand size", RULE_LIMITS.handSize),
  footSize: (v) => whole(v, "the foot size", RULE_LIMITS.footSize),
  extraDecks: (v) => whole(v, "the number of extra decks", RULE_LIMITS.extraDecks),
  initialDiscardFlip: (v) => flag(v, "turning up the first discard"),
  stockExhaustion: (v) => oneOf(v, "what happens when the stock runs out", ["reshuffle", "end"]),
  pauseEnabled: (v) => flag(v, "pausing"),
  scoring: (v) => group(v, "scores", SCORING_CHECKS),
  timers: (v) => group(v, "timers", TIMER_CHECKS),
};

/**
 * Rules that are each in range but do not make a game together. Checked on the
 * finished config, so a change and the preset value it meets are judged as one.
 */
function inconsistency(config: RulesConfig): Check {
  if (config.layDownMinimums.length !== config.rounds) {
    return `give a lay-down minimum for each of the ${config.rounds} rounds`;
  }
  if (config.goOutCleanBooks + config.goOutDirtyBooks < 1) {
    return "going out must need at least one book";
  }
  if (config.timers.capMs < config.timers.baseMs) {
    return "the longest a turn may last cannot be less than the time per turn";
  }
  if (config.mode === "competitive" && config.pauseEnabled) {
    return "a competitive table cannot be paused; choose the family mode to allow pausing";
  }
  return null;
}

/**
 * Turn what a creator asked for into the rules the table will play by, or say
 * why it cannot be dealt.
 *
 * `options` is untyped on purpose: it is whatever JSON a request carried. Every
 * field is checked, unknown ones are refused rather than ignored — a misspelt
 * rule silently dropped is a table playing rules nobody chose — and the result
 * is built only from known keys, so nothing else a request carries can reach the
 * stored config. The preset is recorded in the result, so a table can show which
 * of its rules were changed.
 */
export function resolveRules(options: unknown): Ack<RulesConfig> {
  const fail = (error: string): Ack<RulesConfig> => ({ ok: false, error });
  if (options === undefined || options === null) options = {};
  if (!isPlainObject(options)) return fail("the table's rules were not understood");
  for (const key of Object.keys(options)) {
    if (key !== "preset" && key !== "mode" && key !== "rules") {
      return fail(`there is no table option called "${key}"`);
    }
  }
  const { preset = "east-coast", mode, rules = {} } = options;
  if (!Object.hasOwn(PRESETS, preset as string)) {
    return fail("the variant must be East Coast or West Coast");
  }
  if (mode !== undefined && mode !== "family" && mode !== "competitive") {
    return fail("the mode must be family or competitive");
  }
  if (!isPlainObject(rules)) return fail("the table's rules were not understood");
  for (const [key, value] of Object.entries(rules)) {
    if (!Object.hasOwn(RULE_CHECKS, key)) return fail(`there is no rule called "${key}"`);
    const problem = RULE_CHECKS[key as keyof RulesOverrides](value);
    if (problem) return fail(problem);
  }

  const base = baseRules(preset as RulesPreset, mode as GameMode | undefined);
  const changes = rules as RulesOverrides;
  const config: RulesConfig = {
    ...base,
    ...pick(changes, Object.keys(RULE_CHECKS) as (keyof RulesOverrides)[]),
    layDownMinimums: [...(changes.layDownMinimums ?? base.layDownMinimums)],
    scoring: { ...base.scoring, ...pick(changes.scoring ?? {}, Object.keys(SCORING_CHECKS)) },
    timers: { ...base.timers, ...pick(changes.timers ?? {}, Object.keys(TIMER_CHECKS)) },
  };
  const problem = inconsistency(config);
  return problem ? fail(problem) : { ok: true, data: config };
}

/** Only the named keys that are present: the copy that keeps anything else out. */
function pick<T extends object>(source: T, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) out[key] = (source as Record<string, unknown>)[key];
  }
  return out as Partial<T>;
}

/**
 * The overrides that turn `base` into `config`: only what differs. What a table
 * remembers and sends, so that what it says it changed is exactly what it did.
 */
export function rulesOverrides(config: RulesConfig, base: RulesConfig): RulesOverrides {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(RULE_CHECKS) as (keyof RulesOverrides)[]) {
    if (key === "scoring" || key === "timers") {
      const inner: Record<string, unknown> = {};
      const mine = config[key] as unknown as Record<string, unknown>;
      const theirs = base[key] as unknown as Record<string, unknown>;
      for (const field of Object.keys(theirs)) {
        if (!Object.is(mine[field], theirs[field])) inner[field] = mine[field];
      }
      if (Object.keys(inner).length > 0) out[key] = inner;
    } else if (key === "layDownMinimums") {
      const a = config.layDownMinimums;
      const b = base.layDownMinimums;
      if (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))) out[key] = [...a];
    } else if (!Object.is(config[key], base[key])) {
      out[key] = config[key];
    }
  }
  return out as RulesOverrides;
}

/**
 * The names of the rules a table changed from the preset and mode it was opened
 * with, as `rounds` or `scoring.joker` — what the lobby highlights.
 */
export function changedRules(config: RulesConfig): ReadonlySet<string> {
  const changes = rulesOverrides(config, baseRules(presetOf(config), config.mode));
  const names = new Set<string>();
  for (const [key, value] of Object.entries(changes)) {
    if (key === "scoring" || key === "timers") {
      for (const field of Object.keys(value as object)) names.add(`${key}.${field}`);
    } else {
      names.add(key);
    }
  }
  return names;
}
