/**
 * How hard a computer player plays. All three are the same playing heuristic; they
 * differ only in how often they take the discard pile, which is the single biggest
 * lever in the game (a pile is a handful of cards and usually the lay-down that
 * goes with them). Hard takes it whenever the rules allow, Standard on some of
 * those turns, Easy never. Hard is the one the RL agent replaces when it exists.
 */
export type BotLevel = "easy" | "standard" | "hard";

/** In the order a picker shows them. Only ever add: a level may be stored in a record. */
export const BOT_LEVELS: readonly BotLevel[] = ["easy", "standard", "hard"];

/**
 * A computer player recorded before levels existed has no level, and played as
 * Hard does now, so that is what it reads as.
 */
export const LEGACY_BOT_LEVEL: BotLevel = "hard";

/** The level a new computer player gets when the host does not pick one. */
export const DEFAULT_BOT_LEVEL: BotLevel = "standard";

/** The longest name a host can give a computer player. */
export const MAX_BOT_NAME_LENGTH = 16;

export function isBotLevel(value: unknown): value is BotLevel {
  return typeof value === "string" && (BOT_LEVELS as readonly string[]).includes(value);
}
