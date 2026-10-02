import { afterEach, describe, expect, it } from "vitest";
import { baseRules, EAST_COAST, WEST_COAST } from "@hf/shared";
import {
  DEFAULT_CHOICE,
  draftRules,
  loadRulesChoice,
  rebased,
  rememberRulesChoice,
  RULES_KEY,
  withDraft,
  withRounds,
  type RulesChoice,
} from "./customRules";

afterEach(() => window.localStorage.removeItem(RULES_KEY));

describe("the remembered rules", () => {
  it("pins the storage key, which other devices' pages will read", () => {
    expect(RULES_KEY).toBe("hf.rules");
  });

  it("start as the East Coast family game", () => {
    expect(loadRulesChoice()).toEqual({ preset: "east-coast", mode: "family", rules: {} });
    expect(DEFAULT_CHOICE).toEqual({ preset: "east-coast", mode: "family", rules: {} });
  });

  it("come back as they were saved", () => {
    const choice: RulesChoice = {
      preset: "west-coast",
      mode: "competitive",
      rules: { handSize: 11, scoring: { joker: 40 } },
    };
    rememberRulesChoice(choice);
    expect(loadRulesChoice()).toEqual(choice);
  });

  it("are dropped when the server would refuse them, or cannot be read", () => {
    for (const raw of [
      JSON.stringify({ preset: "east-coast", mode: "family", rules: { handSize: 99 } }),
      JSON.stringify({ preset: "east-coast", rules: {} }),
      JSON.stringify(null),
      "{not json",
    ]) {
      window.localStorage.setItem(RULES_KEY, raw);
      expect(loadRulesChoice()).toEqual(DEFAULT_CHOICE);
    }
  });

  it("fill in no changes for a choice saved without any", () => {
    window.localStorage.setItem(
      RULES_KEY,
      JSON.stringify({ preset: "west-coast", mode: "family" }),
    );
    expect(loadRulesChoice()).toEqual({ preset: "west-coast", mode: "family", rules: {} });
  });

  it("never break the page when storage is blocked", () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => rememberRulesChoice(DEFAULT_CHOICE)).not.toThrow();
      expect(loadRulesChoice()).toEqual(DEFAULT_CHOICE);
    } finally {
      Object.defineProperty(window, "localStorage", real);
    }
  });
});

describe("editing a choice", () => {
  it("drafts the preset with the changes laid over it", () => {
    expect(draftRules(DEFAULT_CHOICE)).toEqual(EAST_COAST);
    const draft = draftRules({
      preset: "west-coast",
      mode: "competitive",
      rules: { handSize: 9, scoring: { ace: 25 }, timers: { incrementMs: 0 } },
    });
    expect(draft).toEqual({
      ...baseRules("west-coast", "competitive"),
      handSize: 9,
      scoring: { ...WEST_COAST.scoring, ace: 25 },
      timers: { ...WEST_COAST.timers, incrementMs: 0 },
    });
  });

  it("keeps only what differs, so setting a rule back un-changes it", () => {
    const changed = withDraft(DEFAULT_CHOICE, { ...EAST_COAST, footSize: 10 });
    expect(changed.rules).toEqual({ footSize: 10 });
    expect(withDraft(changed, EAST_COAST).rules).toEqual({});
  });

  it("carries the changes to another preset, dropping any that preset already has", () => {
    const choice = withDraft(DEFAULT_CHOICE, {
      ...EAST_COAST,
      wildRatio: "naturals-equal-wilds",
      handSize: 12,
    });
    const west = rebased(choice, "west-coast", "family");
    expect(west).toEqual({ preset: "west-coast", mode: "family", rules: { handSize: 12 } });
    // Pausing follows the mode, unless it was itself changed.
    expect(draftRules(rebased(west, "west-coast", "competitive")).pauseEnabled).toBe(false);
  });
});

describe("withRounds", () => {
  const preset = EAST_COAST;

  it("cuts the minimums short, or carries them on from the preset and then in steps of 30", () => {
    expect(withRounds(preset, preset, 2).layDownMinimums).toEqual([60, 90]);
    const custom = { ...preset, layDownMinimums: [10, 20] };
    expect(withRounds(custom, preset, 6)).toMatchObject({
      rounds: 6,
      layDownMinimums: [10, 20, 120, 150, 180, 210],
    });
    expect(
      withRounds({ ...preset, layDownMinimums: [] }, { ...preset, layDownMinimums: [] }, 2)
        .layDownMinimums,
    ).toEqual([60, 90]);
  });

  it("never grows the list past a match's length, however many rounds are typed", () => {
    const draft = withRounds(preset, preset, 1_000_000_000);
    expect(draft.rounds).toBe(1_000_000_000);
    expect(draft.layDownMinimums).toHaveLength(8);
    expect(withRounds(preset, preset, Number.NaN).layDownMinimums).toEqual([]);
    expect(withRounds(preset, preset, -3).layDownMinimums).toEqual([]);
  });
});
