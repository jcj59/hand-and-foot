import { EAST_COAST, type RulesConfig } from "@hf/shared";

export * from "./deck";
export * from "./rng";
export * from "./deal";
export * from "./view";
export * from "./meld";
export * from "./scoring";
export * from "./scoreRound";
export * from "./reducer";
export * from "./nextRound";
export * from "./removePlayer";
export * from "./seats";
export * from "./feasibility";
export * from "./plan";
export * from "./policy";
export * from "./goout";
export * from "./legal";
export * from "./replay";
export * from "./takeBack";
export * from "./grabby";
export * from "./lastMove";
export * from "./playback";
export * from "./marva";
export * from "./arena";

export const defaultConfig: RulesConfig = EAST_COAST;

export function engineVersion(): string {
  return "0.0.0";
}
