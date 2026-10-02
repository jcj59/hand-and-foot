import { describe, expect, it } from "vitest";
import {
  baseRules,
  changedRules,
  EAST_COAST,
  presetOf,
  resolveRules,
  RULE_LIMITS,
  rulesOverrides,
  WEST_COAST,
  type RulesConfig,
} from "./index";

/** The config, or the test fails with the refusal it got instead. */
function accepted(options: unknown): RulesConfig {
  const result = resolveRules(options);
  if (!result.ok) throw new Error(`refused: ${result.error}`);
  return result.data;
}

function refusal(options: unknown): string {
  const result = resolveRules(options);
  if (result.ok) throw new Error("accepted rules that should have been refused");
  return result.error;
}

describe("resolveRules: presets and modes", () => {
  it("gives the East Coast family game when nothing is chosen", () => {
    expect(accepted(undefined)).toEqual(EAST_COAST);
    expect(accepted(null)).toEqual(EAST_COAST);
    expect(accepted({})).toEqual(EAST_COAST);
  });

  it("selects the West Coast preset", () => {
    expect(accepted({ preset: "west-coast" })).toEqual(WEST_COAST);
    expect(accepted({ preset: "east-coast" })).toEqual(EAST_COAST);
  });

  it("turns pausing off with the competitive mode, and on with family", () => {
    const competitive = accepted({ mode: "competitive" });
    expect(competitive.mode).toBe("competitive");
    expect(competitive.pauseEnabled).toBe(false);
    const family = accepted({ preset: "west-coast", mode: "family" });
    expect(family.mode).toBe("family");
    expect(family.pauseEnabled).toBe(true);
    expect(family.wildRatio).toBe("naturals-equal-wilds");
  });

  it("refuses a variant or mode it does not know, rather than guessing", () => {
    expect(refusal({ preset: "north-pole" })).toBe("the variant must be East Coast or West Coast");
    expect(refusal({ preset: "toString" })).toBe("the variant must be East Coast or West Coast");
    expect(refusal({ preset: null })).toBe("the variant must be East Coast or West Coast");
    expect(refusal({ mode: "whatever" })).toBe("the mode must be family or competitive");
    expect(refusal({ mode: null })).toBe("the mode must be family or competitive");
  });

  it("refuses options that are not an object, and options it does not know", () => {
    expect(refusal("east-coast")).toBe("the table's rules were not understood");
    expect(refusal([])).toBe("the table's rules were not understood");
    expect(refusal({ rules: [] })).toBe("the table's rules were not understood");
    expect(refusal({ rules: "fast" })).toBe("the table's rules were not understood");
    expect(refusal({ cheat: true })).toBe('there is no table option called "cheat"');
  });

  it("records the preset the rules started from", () => {
    expect(
      accepted({ preset: "west-coast", rules: { rounds: 1, layDownMinimums: [50] } }).preset,
    ).toBe("west-coast");
    expect(accepted({ rules: { handSize: 11 } }).preset).toBe("east-coast");
  });
});

describe("resolveRules: changes to the preset", () => {
  it("applies every kind of change on top of the preset", () => {
    const config = accepted({
      preset: "west-coast",
      rules: {
        rounds: 2,
        layDownMinimums: [50, 0],
        wildRatio: "naturals-exceed-wilds",
        marvaRule: false,
        goOutCleanBooks: 2,
        goOutDirtyBooks: 0,
        handSize: 11,
        footSize: 13,
        extraDecks: 0,
        initialDiscardFlip: false,
        stockExhaustion: "end",
        pauseEnabled: false,
        scoring: { joker: 40, redThree: -300 },
        timers: { baseMs: 60_000, capMs: 60_000, incrementMs: 0, discardGraceMs: 5_000 },
      },
    });
    expect(config).toEqual({
      ...WEST_COAST,
      rounds: 2,
      layDownMinimums: [50, 0],
      wildRatio: "naturals-exceed-wilds",
      marvaRule: false,
      goOutCleanBooks: 2,
      goOutDirtyBooks: 0,
      handSize: 11,
      footSize: 13,
      extraDecks: 0,
      initialDiscardFlip: false,
      stockExhaustion: "end",
      pauseEnabled: false,
      scoring: { ...WEST_COAST.scoring, joker: 40, redThree: -300 },
      timers: { baseMs: 60_000, capMs: 60_000, incrementMs: 0, discardGraceMs: 5_000 },
    });
  });

  it("leaves the presets themselves untouched", () => {
    accepted({ rules: { layDownMinimums: [1, 2, 3, 4], scoring: { joker: 1 } } });
    expect(EAST_COAST.layDownMinimums).toEqual([60, 90, 120, 150]);
    expect(EAST_COAST.scoring.joker).toBe(50);
  });

  it("keeps nothing in the config that is not a rule", () => {
    // A request could carry anything; only known keys are copied into what is stored.
    const parsed = JSON.parse('{"rules":{"scoring":{},"timers":{}}}') as unknown;
    expect(accepted(parsed)).toEqual(EAST_COAST);
  });

  it("refuses a rule it does not know, so a misspelling is never silently dropped", () => {
    expect(refusal({ rules: { handsize: 11 } })).toBe('there is no rule called "handsize"');
    expect(refusal({ rules: { mode: "competitive" } })).toBe('there is no rule called "mode"');
    expect(refusal({ rules: { preset: "west-coast" } })).toBe('there is no rule called "preset"');
    expect(refusal({ rules: { scoring: { queen: 10 } } })).toBe('there is no score called "queen"');
    expect(refusal({ rules: { timers: { totalMs: 1000 } } })).toBe(
      'there is no timer called "totalMs"',
    );
    expect(refusal({ rules: { scoring: 5 } })).toBe("the scores were not understood");
    expect(refusal({ rules: { timers: [] } })).toBe("the timers were not understood");
  });

  it("refuses a request trying to reach the prototype", () => {
    // JSON.parse makes `__proto__` an ordinary own key, which is how it would arrive.
    expect(refusal(JSON.parse('{"__proto__":{"x":1}}'))).toBe(
      'there is no table option called "__proto__"',
    );
    expect(refusal(JSON.parse('{"rules":{"__proto__":{"handSize":3}}}'))).toBe(
      'there is no rule called "__proto__"',
    );
    expect(refusal(JSON.parse('{"rules":{"scoring":{"__proto__":{}}}}'))).toBe(
      'there is no score called "__proto__"',
    );
    expect(refusal({ rules: { constructor: 1 } })).toBe('there is no rule called "constructor"');
  });
});

describe("resolveRules: ranges", () => {
  /** Each rule at its bounds is accepted, and one past them is refused with its name. */
  const numeric: readonly {
    readonly rules: (v: number) => object;
    readonly min: number;
    readonly max: number;
    readonly name: string;
  }[] = [
    {
      rules: (v) => ({ rounds: v, layDownMinimums: Array.from({ length: v }, () => 50) }),
      ...RULE_LIMITS.rounds,
      name: "the number of rounds",
    },
    {
      rules: (v) => ({ layDownMinimums: [v, 90, 120, 150] }),
      ...RULE_LIMITS.layDownMinimum,
      name: "the round 1 minimum",
    },
    {
      rules: (v) => ({ goOutCleanBooks: v }),
      ...RULE_LIMITS.goOutBooks,
      name: "the clean books needed to go out",
    },
    {
      rules: (v) => ({ goOutDirtyBooks: v }),
      ...RULE_LIMITS.goOutBooks,
      name: "the dirty books needed to go out",
    },
    { rules: (v) => ({ handSize: v }), ...RULE_LIMITS.handSize, name: "the hand size" },
    { rules: (v) => ({ footSize: v }), ...RULE_LIMITS.footSize, name: "the foot size" },
    {
      rules: (v) => ({ extraDecks: v }),
      ...RULE_LIMITS.extraDecks,
      name: "the number of extra decks",
    },
    {
      rules: (v) => ({ scoring: { joker: v } }),
      ...RULE_LIMITS.cardValue,
      name: "a joker's value",
    },
    { rules: (v) => ({ scoring: { two: v } }), ...RULE_LIMITS.cardValue, name: "a two's value" },
    { rules: (v) => ({ scoring: { ace: v } }), ...RULE_LIMITS.cardValue, name: "an ace's value" },
    {
      rules: (v) => ({ scoring: { tenToKing: v } }),
      ...RULE_LIMITS.cardValue,
      name: "the value of a ten to king",
    },
    {
      rules: (v) => ({ scoring: { fourToNine: v } }),
      ...RULE_LIMITS.cardValue,
      name: "the value of a four to nine",
    },
    {
      rules: (v) => ({ scoring: { blackThree: v } }),
      ...RULE_LIMITS.cardValue,
      name: "a black three's value",
    },
    {
      rules: (v) => ({ scoring: { redThree: v } }),
      ...RULE_LIMITS.redThree,
      name: "a red three's value",
    },
    {
      rules: (v) => ({ scoring: { cleanBookBonus: v } }),
      ...RULE_LIMITS.bonus,
      name: "the clean book bonus",
    },
    {
      rules: (v) => ({ scoring: { dirtyBookBonus: v } }),
      ...RULE_LIMITS.bonus,
      name: "the dirty book bonus",
    },
    {
      rules: (v) => ({ scoring: { goOutBonus: v } }),
      ...RULE_LIMITS.bonus,
      name: "the going out bonus",
    },
  ];

  for (const rule of numeric) {
    it(`bounds ${rule.name}`, () => {
      accepted({ rules: rule.rules(rule.min) });
      accepted({ rules: rule.rules(rule.max) });
      const range = `${rule.name} must be between ${rule.min} and ${rule.max}`;
      expect(refusal({ rules: rule.rules(rule.min - 1) })).toBe(range);
      expect(refusal({ rules: rule.rules(rule.max + 1) })).toBe(range);
      const whole = `${rule.name} must be a whole number`;
      expect(refusal({ rules: rule.rules(rule.min + 0.5) })).toBe(whole);
      expect(refusal({ rules: rule.rules(Number.NaN) })).toBe(whole);
      expect(refusal({ rules: rule.rules("10" as unknown as number) })).toBe(whole);
    });
  }

  const timers: readonly {
    readonly field: string;
    readonly min: number;
    readonly max: number;
    readonly name: string;
  }[] = [
    { field: "baseMs", ...RULE_LIMITS.baseMs, name: "the time per turn" },
    { field: "incrementMs", ...RULE_LIMITS.incrementMs, name: "the time added per move" },
    { field: "capMs", ...RULE_LIMITS.capMs, name: "the longest a turn may last" },
    { field: "discardGraceMs", ...RULE_LIMITS.discardGraceMs, name: "the time to discard" },
  ];

  for (const timer of timers) {
    it(`bounds ${timer.name}, in whole seconds`, () => {
      // Base and cap move together here so that only the bound under test can refuse.
      const at = (ms: number): object => ({
        timers:
          timer.field === "baseMs"
            ? { baseMs: ms, capMs: Math.max(ms, 10_000) }
            : timer.field === "capMs"
              ? { baseMs: 10_000, capMs: ms }
              : { [timer.field]: ms },
      });
      accepted({ rules: at(timer.min) });
      accepted({ rules: at(timer.max) });
      const range = `${timer.name} must be between ${timer.min / 1000} and ${timer.max / 1000} seconds`;
      expect(refusal({ rules: at(timer.min - 1000) })).toBe(range);
      expect(refusal({ rules: at(timer.max + 1000) })).toBe(range);
      const whole = `${timer.name} must be a whole number of seconds`;
      expect(refusal({ rules: at(timer.min + 500) })).toBe(whole);
      expect(refusal({ rules: at(timer.min + 0.5) })).toBe(whole);
      expect(refusal({ rules: at("60000" as unknown as number) })).toBe(whole);
    });
  }

  it("pins the limits a player reads in the editor", () => {
    // Literal, not symbolic: the form's hints and these checks must not move apart.
    expect(RULE_LIMITS).toEqual({
      rounds: { min: 1, max: 8 },
      layDownMinimum: { min: 0, max: 500 },
      goOutBooks: { min: 0, max: 5 },
      handSize: { min: 5, max: 20 },
      footSize: { min: 5, max: 20 },
      extraDecks: { min: 0, max: 4 },
      cardValue: { min: 0, max: 500 },
      redThree: { min: -1000, max: 0 },
      bonus: { min: 0, max: 2000 },
      baseMs: { min: 10_000, max: 600_000 },
      incrementMs: { min: 0, max: 60_000 },
      capMs: { min: 10_000, max: 1_800_000 },
      discardGraceMs: { min: 5_000, max: 120_000 },
    });
  });

  it("refuses a switch that is not on or off, and a choice outside its options", () => {
    expect(refusal({ rules: { marvaRule: "yes" } })).toBe("the Marva rule must be on or off");
    expect(refusal({ rules: { initialDiscardFlip: 1 } })).toBe(
      "turning up the first discard must be on or off",
    );
    expect(refusal({ rules: { pauseEnabled: null } })).toBe("pausing must be on or off");
    expect(refusal({ rules: { wildRatio: "anything-goes" } })).toBe(
      "the wild card rule must be naturals-exceed-wilds or naturals-equal-wilds",
    );
    expect(refusal({ rules: { stockExhaustion: "panic" } })).toBe(
      "what happens when the stock runs out must be reshuffle or end",
    );
  });

  it("refuses minimums that are not a list, or longer than any match", () => {
    for (const notAList of [60, null, { 0: 60, length: 1 }]) {
      expect(refusal({ rules: { layDownMinimums: notAList } })).toBe(
        "the lay-down minimums must be a list, one for each round",
      );
    }
    expect(refusal({ rules: { layDownMinimums: Array.from({ length: 9 }, () => 0) } })).toBe(
      "there are more lay-down minimums than rounds",
    );
    expect(refusal({ rules: { layDownMinimums: [60, 90, -5, 150] } })).toBe(
      "the round 3 minimum must be between 0 and 500",
    );
  });
});

describe("resolveRules: rules that do not make a game together", () => {
  it("needs a minimum for every round, judged against the preset's other values", () => {
    expect(refusal({ rules: { rounds: 3 } })).toBe(
      "give a lay-down minimum for each of the 3 rounds",
    );
    expect(refusal({ rules: { layDownMinimums: [60, 90] } })).toBe(
      "give a lay-down minimum for each of the 4 rounds",
    );
    expect(accepted({ rules: { rounds: 2, layDownMinimums: [60, 90] } }).rounds).toBe(2);
  });

  it("needs at least one book to go out", () => {
    expect(refusal({ rules: { goOutCleanBooks: 0, goOutDirtyBooks: 0 } })).toBe(
      "going out must need at least one book",
    );
    expect(accepted({ rules: { goOutCleanBooks: 0, goOutDirtyBooks: 1 } }).goOutDirtyBooks).toBe(1);
    expect(accepted({ rules: { goOutCleanBooks: 1, goOutDirtyBooks: 0 } }).goOutCleanBooks).toBe(1);
  });

  it("will not let the turn's ceiling sit below where it starts", () => {
    expect(refusal({ rules: { timers: { baseMs: 200_000 } } })).toBe(
      "the longest a turn may last cannot be less than the time per turn",
    );
    expect(accepted({ rules: { timers: { baseMs: 180_000 } } }).timers.capMs).toBe(180_000);
  });

  it("will not pause a competitive table", () => {
    expect(refusal({ mode: "competitive", rules: { pauseEnabled: true } })).toBe(
      "a competitive table cannot be paused; choose the family mode to allow pausing",
    );
    expect(accepted({ mode: "family", rules: { pauseEnabled: false } }).pauseEnabled).toBe(false);
  });
});

describe("rulesOverrides and changedRules", () => {
  it("are empty for a preset as it comes", () => {
    expect(rulesOverrides(EAST_COAST, EAST_COAST)).toEqual({});
    expect(changedRules(WEST_COAST).size).toBe(0);
    expect(changedRules(baseRules("west-coast", "competitive")).size).toBe(0);
  });

  it("name exactly what changed, and resolve back to the same rules", () => {
    const options = {
      preset: "west-coast" as const,
      mode: "competitive" as const,
      rules: {
        rounds: 3,
        layDownMinimums: [50, 90, 120],
        marvaRule: false,
        scoring: { joker: 40 },
        timers: { incrementMs: 0 },
      },
    };
    const config = accepted(options);
    const base = baseRules("west-coast", "competitive");
    expect(rulesOverrides(config, base)).toEqual(options.rules);
    expect(accepted({ ...options, rules: rulesOverrides(config, base) })).toEqual(config);
    expect([...changedRules(config)].sort()).toEqual([
      "layDownMinimums",
      "marvaRule",
      "rounds",
      "scoring.joker",
      "timers.incrementMs",
    ]);
  });

  it("keep the minimums of a shorter match even where they match the preset's first rounds", () => {
    const config = accepted({ rules: { rounds: 2, layDownMinimums: [60, 90] } });
    expect(rulesOverrides(config, EAST_COAST)).toEqual({ rounds: 2, layDownMinimums: [60, 90] });
  });

  it("see a changed minimum in the same number of rounds", () => {
    const config = accepted({ rules: { layDownMinimums: [60, 90, 120, 200] } });
    expect([...changedRules(config)]).toEqual(["layDownMinimums"]);
  });

  it("compare a table from before the editor with the preset it must have been", () => {
    // Stored before configs named their preset: the wild ratio is what told them apart.
    const stored = (c: RulesConfig): RulesConfig =>
      JSON.parse(JSON.stringify({ ...c, preset: undefined })) as RulesConfig;
    const oldEast = stored(EAST_COAST);
    const oldWest = stored(WEST_COAST);
    expect(presetOf(oldEast)).toBe("east-coast");
    expect(presetOf(oldWest)).toBe("west-coast");
    expect(changedRules({ ...oldWest, marvaRule: false })).toEqual(new Set(["marvaRule"]));
  });
});
