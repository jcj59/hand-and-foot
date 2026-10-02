/**
 * The rules a player is choosing for a new table, and the last ones they opened
 * a table with.
 *
 * What is chosen is a preset, a mode and the changes to them — not a whole config
 * — because that is what the server is sent and what it checks, and because a
 * change kept apart from its preset survives switching to the other preset.
 *
 * Remembered per device for now (`hf.rules`), like the name and the mute switch.
 * It belongs with the player's identity, and moves there once identities carry
 * settings; until then a second device starts from the preset.
 */
import {
  baseRules,
  resolveRules,
  RULE_LIMITS,
  rulesOverrides,
  type GameMode,
  type RulesConfig,
  type RulesOverrides,
  type RulesPreset,
} from "@hf/shared";

export const RULES_KEY = "hf.rules";

export interface RulesChoice {
  readonly preset: RulesPreset;
  readonly mode: GameMode;
  readonly rules: RulesOverrides;
}

export const DEFAULT_CHOICE: RulesChoice = { preset: "east-coast", mode: "family", rules: {} };

/**
 * The last rules this device opened a table with, or the default. Anything the
 * server would now refuse — stored by an older version, or edited by hand — is
 * dropped rather than offered, since it could only fail on the way out.
 */
export function loadRulesChoice(): RulesChoice {
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    if (raw === null) return DEFAULT_CHOICE;
    const parsed = JSON.parse(raw) as RulesChoice;
    if (!resolveRules(parsed).ok || parsed.mode === undefined) return DEFAULT_CHOICE;
    return { preset: parsed.preset, mode: parsed.mode, rules: parsed.rules ?? {} };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function rememberRulesChoice(choice: RulesChoice): void {
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(choice));
  } catch {
    // Blocked storage: the next table starts from the preset.
  }
}

/**
 * The rules a choice describes, whether or not they would be accepted — what the
 * editor shows while a value is half typed. `resolveRules` is what says whether
 * they make a game.
 */
export function draftRules(choice: RulesChoice): RulesConfig {
  const base = baseRules(choice.preset, choice.mode);
  const { rules } = choice;
  return {
    ...base,
    ...rules,
    scoring: { ...base.scoring, ...rules.scoring },
    timers: { ...base.timers, ...rules.timers },
  };
}

/**
 * The choice with its rules replaced by `draft`, keeping only what differs from
 * the preset — so setting a rule back to the preset's value un-changes it.
 */
export function withDraft(choice: RulesChoice, draft: RulesConfig): RulesChoice {
  return { ...choice, rules: rulesOverrides(draft, baseRules(choice.preset, choice.mode)) };
}

/** The same changes, against another preset or mode. */
export function rebased(choice: RulesChoice, preset: RulesPreset, mode: GameMode): RulesChoice {
  return withDraft({ ...choice, preset, mode }, draftRules({ ...choice, preset, mode }));
}

/**
 * A match of `rounds` rounds: the minimums cut short, or carried on from the
 * preset's own and then in steps of 30 past its end.
 */
export function withRounds(draft: RulesConfig, preset: RulesConfig, rounds: number): RulesConfig {
  // Never more than a match can have, however many rounds are typed: the count
  // itself is refused by the check, and the list must not grow without end first.
  const wanted = Math.min(rounds, RULE_LIMITS.rounds.max);
  const minimums = draft.layDownMinimums.slice(0, Math.max(0, wanted));
  while (minimums.length < wanted) {
    const i = minimums.length;
    minimums.push(preset.layDownMinimums[i] ?? (minimums[i - 1] ?? 30) + 30);
  }
  return { ...draft, rounds, layDownMinimums: minimums };
}
