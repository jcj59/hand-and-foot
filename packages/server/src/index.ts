import { defaultConfig } from "@hf/engine";

// Placeholder server entry. The authoritative Socket.io server, room manager,
// pacing/timers, and action-log persistence land in M2.

export function describeServer(): string {
  return `hand-and-foot server (rounds=${defaultConfig.rounds}, mode=${defaultConfig.mode})`;
}
