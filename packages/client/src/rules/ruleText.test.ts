import { describe, expect, it } from "vitest";
import { changedRules, EAST_COAST, resolveRules, WEST_COAST, type RulesConfig } from "@hf/shared";
import { formatTime, RULE_GROUPS, ruleLines, rulesName } from "./ruleText";

function custom(options: unknown): RulesConfig {
  const result = resolveRules(options);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe("ruleLines", () => {
  it("say every rule of the preset in words, with nothing marked as changed", () => {
    const lines = ruleLines(EAST_COAST);
    expect(lines.every((l) => l.was === null)).toBe(true);
    expect(Object.fromEntries(lines.map((l) => [l.label, l.value]))).toEqual({
      Rounds: "4",
      "Lay-down minimums": "60 · 90 · 120 · 150",
      "Wild cards in a meld": "Fewer than naturals",
      "Marva rule": "On",
      "Clean books to go out": "1",
      "Dirty books to go out": "2",
      Hand: "14 cards",
      Foot: "14 cards",
      Decks: "One per player and 1 more",
      "First discard turned up": "On",
      "When the stock runs out": "The discard pile is reshuffled",
      Joker: "50",
      Two: "20",
      Ace: "15",
      "Ten to king": "10",
      "Four to nine": "5",
      "Black three": "5",
      "Red three": "−500",
      "Clean book bonus": "500",
      "Dirty book bonus": "300",
      "Going out bonus": "100",
      "Time per turn": "1 min 30 s",
      "Added per move": "10 s",
      "Longest turn": "3 min",
      "Time to discard after": "20 s",
      "Pausing allowed": "Yes",
    });
    expect(new Set(lines.map((l) => l.group))).toEqual(new Set(RULE_GROUPS));
  });

  it("mark every rule a table can change, beside what the preset has", () => {
    // Every rule changed at once, so no rule `changedRules` can name is left unsaid.
    const everything = custom({
      preset: "west-coast",
      mode: "family",
      rules: {
        rounds: 1,
        layDownMinimums: [0],
        wildRatio: "naturals-exceed-wilds",
        marvaRule: false,
        goOutCleanBooks: 2,
        goOutDirtyBooks: 1,
        handSize: 11,
        footSize: 5,
        extraDecks: 0,
        initialDiscardFlip: false,
        stockExhaustion: "end",
        pauseEnabled: false,
        scoring: {
          joker: 1,
          two: 1,
          ace: 1,
          tenToKing: 1,
          fourToNine: 1,
          blackThree: 1,
          redThree: 0,
          cleanBookBonus: 1,
          dirtyBookBonus: 1,
          goOutBonus: 1,
        },
        timers: { baseMs: 30_000, incrementMs: 0, capMs: 30_000, discardGraceMs: 5_000 },
      },
    });
    const lines = ruleLines(everything);
    expect(lines.map((l) => l.id).sort()).toEqual([...changedRules(everything)].sort());
    expect(lines.every((l) => l.was !== null && l.was !== l.value)).toBe(true);
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, [l.value, l.was]]));
    expect(byLabel["Wild cards in a meld"]).toEqual([
      "Fewer than naturals",
      "Up to as many as naturals",
    ]);
    expect(byLabel["Decks"]).toEqual(["One per player", "One per player and 1 more"]);
    expect(byLabel["When the stock runs out"]).toEqual([
      "The round ends",
      "The discard pile is reshuffled",
    ]);
    expect(byLabel["Pausing allowed"]).toEqual(["No", "Yes"]);
    expect(byLabel["Red three"]).toEqual(["0", "−500"]);
    expect(byLabel["Foot"]).toEqual(["5 cards", "14 cards"]);
  });

  it("compare a competitive table with the competitive preset, not the family one", () => {
    const config = custom({ mode: "competitive" });
    expect(ruleLines(config).filter((l) => l.was !== null)).toEqual([]);
  });
});

describe("rulesName", () => {
  it("names the preset and mode, including for a table from before presets were recorded", () => {
    expect(rulesName(EAST_COAST)).toBe("East Coast · Family");
    const old = JSON.parse(
      JSON.stringify({ ...WEST_COAST, mode: "competitive", preset: undefined }),
    ) as RulesConfig;
    expect(rulesName(old)).toBe("West Coast · Competitive");
  });
});

describe("formatTime", () => {
  it("says a time the way a player would", () => {
    expect(formatTime(5_000)).toBe("5 s");
    expect(formatTime(59_000)).toBe("59 s");
    expect(formatTime(60_000)).toBe("1 min");
    expect(formatTime(90_000)).toBe("1 min 30 s");
    expect(formatTime(1_800_000)).toBe("30 min");
  });

  it("says one card, not one cards", () => {
    // Hand sizes cannot be 1, but the wording should not depend on that.
    const one = ruleLines({ ...EAST_COAST, handSize: 1 }).find((l) => l.id === "handSize")!;
    expect(one.value).toBe("1 card");
  });
});
