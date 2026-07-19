import { EAST_COAST, type RulesConfig } from "@hf/shared";

// Placeholder for the pure rules engine. The real (state, action) => state reducer,
// scoring, and validation land in M1. This just proves the workspace wiring resolves.

export const defaultConfig: RulesConfig = EAST_COAST;

export function engineVersion(): string {
  return "0.0.0";
}
