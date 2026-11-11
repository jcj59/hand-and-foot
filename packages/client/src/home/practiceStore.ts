/**
 * The last practice game this device dealt: its rules and its computers, offered
 * again next time. Until there is one, practice starts from the rules this device
 * last opened a table with (always the family game: practice has no turn clock)
 * and three computers at Standard, the four-player table the game is made for.
 */
import { BOT_LEVELS, MAX_PLAYERS, resolveRules } from "@hf/shared";
import { loadRulesChoice, rebased, type RulesChoice } from "../rules/customRules";
import type { PlannedBot } from "./sheets";

export const PRACTICE_KEY = "hf.practice";

export interface PracticeSetup {
  readonly choice: RulesChoice;
  readonly bots: readonly PlannedBot[];
}

const STANDARD: PlannedBot = { level: "standard", name: "" };

/** The setup to offer; anything the server would now refuse is dropped, as for the rules. */
export function loadPractice(): PracticeSetup {
  const fallback = (): PracticeSetup => {
    const last = loadRulesChoice();
    return {
      choice: last.mode === "family" ? last : rebased(last, last.preset, "family"),
      bots: [STANDARD, STANDARD, STANDARD],
    };
  };
  try {
    const raw = window.localStorage.getItem(PRACTICE_KEY);
    if (raw === null) return fallback();
    const parsed = JSON.parse(raw) as Partial<PracticeSetup>;
    const { choice, bots } = parsed;
    if (!choice || choice.mode !== "family" || !resolveRules(choice).ok) return fallback();
    if (
      !Array.isArray(bots) ||
      bots.length < 1 ||
      bots.length > MAX_PLAYERS - 1 ||
      !bots.every(
        (b: PlannedBot) =>
          typeof b === "object" &&
          b !== null &&
          BOT_LEVELS.includes(b.level) &&
          typeof b.name === "string",
      )
    ) {
      return fallback();
    }
    return {
      choice: { preset: choice.preset, mode: "family", rules: choice.rules ?? {} },
      bots: bots.map((b) => ({ level: b.level, name: b.name })),
    };
  } catch {
    return fallback();
  }
}

export function rememberPractice(setup: PracticeSetup): void {
  try {
    window.localStorage.setItem(PRACTICE_KEY, JSON.stringify(setup));
  } catch {
    // Blocked storage: the next practice starts from the default.
  }
}
