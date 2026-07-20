import { EAST_COAST, type RulesConfig } from "@hf/shared";

export * from "./deck";
export * from "./rng";
export * from "./deal";
export * from "./view";
export * from "./meld";
export * from "./scoring";
export * from "./reducer";

export const defaultConfig: RulesConfig = EAST_COAST;

export function engineVersion(): string {
  return "0.0.0";
}
