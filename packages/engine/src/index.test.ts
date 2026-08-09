import { describe, it, expect } from "vitest";
import { EAST_COAST } from "@hf/shared";
import * as engine from "./index";

/**
 * The package's public surface. Every engine module is re-exported from index.ts,
 * and consumers (the server, the client, and the agent) import from the package
 * root rather than from individual files. This list is what they are entitled to
 * rely on; dropping a re-export is a breaking change, so it fails here.
 */
const PUBLIC_API = [
  // deck
  "standardDeck",
  "buildShoe",
  // rng
  "prng",
  "shuffle",
  // deal
  "deal",
  // view
  "project",
  // meld
  "validateMeld",
  "isValidMeld",
  "countWilds",
  "naturalRank",
  // scoring
  "cardValue",
  "classifyBook",
  "meldPoints",
  "scoreRound",
  // reducer
  "applyAction",
  // feasibility
  "canTakePile",
  // goout
  "canGoOut",
  "claimsGoOut",
  "bookCounts",
  // legal
  "legalHints",
  // replay
  "replay",
  // package-level
  "defaultConfig",
  "engineVersion",
] as const;

describe("@hf/engine public surface", () => {
  for (const name of PUBLIC_API) {
    it(`re-exports ${name}`, () => {
      expect(engine).toHaveProperty(name);
    });
  }

  it("defaults to the East Coast preset", () => {
    expect(engine.defaultConfig).toEqual(EAST_COAST);
  });

  it("reports an engine version", () => {
    expect(typeof engine.engineVersion()).toBe("string");
  });

  it("does not leak the internal reducer helpers", () => {
    // core.ts is deliberately private: ok/fail/advanceTurn and the zone helpers are
    // implementation details of the reducer, not part of the contract.
    for (const internal of ["ok", "fail", "advanceTurn", "activeCards", "setActiveCards"]) {
      expect(engine).not.toHaveProperty(internal);
    }
  });
});
