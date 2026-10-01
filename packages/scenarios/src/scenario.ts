import type { RulesConfig } from "@hf/shared";
import { deal, type GameLog } from "@hf/engine";
import { arrange, type TableSpec } from "./arrange";
import { resolveScript, type ScriptStep } from "./script";

/**
 * One situation worth watching, as data: the rules, how the table starts, and
 * what is played. Adding a scenario is adding one of these to the library.
 */
export interface Scenario {
  /** For the URL: `/scenarios/<id>`. */
  readonly id: string;
  readonly title: string;
  /** What to look for, in a sentence or two. */
  readonly description: string;
  readonly config: RulesConfig;
  /** A fresh deal from a seed, or a table arranged by hand. */
  readonly setup: { readonly seed: number; readonly playerCount: number } | TableSpec;
  readonly names: readonly string[];
  readonly script: readonly ScriptStep[];
  /** The seat the viewer watches by default: whoever the situation is about. */
  readonly watch?: number;
}

/**
 * A scenario as the player takes it: the same `GameLog` a recorded match would be.
 * The setup is turned into a concrete starting state here and the script into
 * actions, so the player never sees anything scenario-specific.
 */
export function buildScenario(scenario: Scenario): GameLog {
  const start =
    "seats" in scenario.setup
      ? arrange(scenario.setup, scenario.config)
      : deal(scenario.setup.playerCount, scenario.config, scenario.setup.seed);
  if (scenario.names.length !== start.players.length) {
    throw new Error(
      `${scenario.id}: ${scenario.names.length} names for ${start.players.length} seats`,
    );
  }
  let resolved;
  try {
    resolved = resolveScript(start, scenario.script);
  } catch (error) {
    throw new Error(`${scenario.id}: ${(error as Error).message}`);
  }
  return {
    config: scenario.config,
    // A seeded deal stays a seed, as a recorded match's would.
    setup: "seats" in scenario.setup ? { state: start } : scenario.setup,
    actions: resolved.actions,
    names: scenario.names,
    moments: resolved.moments,
  };
}
