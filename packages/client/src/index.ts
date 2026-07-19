import type { RulesConfig } from "@hf/shared";

// Placeholder client entry. The React + Vite app (lobby, table, staging UX) lands in M3.

export function roundsForConfig(config: RulesConfig): number {
  return config.rounds;
}
