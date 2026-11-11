import { describe, expect, it } from "vitest";
import type { MatchListing } from "@hf/shared";
import {
  NO_FILTERS,
  PLACES,
  SORTS,
  WHENS,
  companions,
  filterGames,
  since,
  summary,
  toggled,
  type Filters,
} from "./filters";

function listing(over: Partial<MatchListing>): MatchListing {
  return {
    id: "m1",
    roomId: "ABC234",
    endedAt: 0,
    rounds: 4,
    roundsPlayed: 4,
    finished: true,
    seat: 0,
    place: 1,
    won: true,
    preset: "east-coast",
    awards: [],
    players: [],
    ...over,
  };
}

const at = (y: number, m: number, d: number): number => new Date(y, m, d, 12).getTime();
const NOW = at(2026, 10, 11);

/** Ana's games, seat 0 in each, with the people named and these totals. */
function game(id: string, endedAt: number, total: number, over: Partial<MatchListing> = {}) {
  return listing({
    id,
    endedAt,
    players: [
      { seat: 0, name: "Ana", total },
      { seat: 1, name: "Kate", total: 1000 },
    ],
    ...over,
  });
}

const won = game("won", at(2026, 10, 7), 14320);
const second = game("second", at(2026, 10, 3), 9870, {
  won: false,
  place: 2,
  players: [
    { seat: 0, name: "Ana", total: 9870 },
    { seat: 1, name: "Sam", total: 11200 },
    { seat: 2, name: "Priya", total: 7650 },
  ],
});
const unfinished = game("unfinished", at(2026, 9, 30), 4180, {
  finished: false,
  roundsPlayed: 2,
  place: null,
  won: false,
  players: [
    { seat: 0, name: "Ana", total: 4180 },
    { seat: 1, name: "Kate", total: 3990 },
    { seat: 2, name: "Mom", total: 2700 },
  ],
});
const practice = game("practice", at(2026, 9, 26), 10050, {
  players: [
    { seat: 0, name: "Ana", total: 10050 },
    { seat: 1, name: "Kate", bot: true, total: 8800 },
  ],
});
const third = game("third", at(2026, 9, 19), 7210, {
  won: false,
  place: 3,
  players: [
    { seat: 0, name: "Ana", total: 7210 },
    { seat: 1, name: "Mom", total: 12400 },
    { seat: 2, name: "Dad", total: 9900 },
    { seat: 3, name: "Kate", total: 6050 },
  ],
});
const old = game("old", at(2026, 7, 10), 13050, {
  players: [
    { seat: 0, name: "Ana", total: 13050 },
    { seat: 1, name: "Dad", total: 11880 },
    { seat: 2, name: "Kate", total: 10400 },
  ],
});
const recent = [won, second, unfinished, practice, third, old];

function shown(over: Partial<Filters>, games: readonly MatchListing[] = recent): string[] {
  return filterGames(games, { ...NO_FILTERS, ...over }, NOW).map((g) => g.id);
}

describe("the filters' choices", () => {
  it("are the mockup's, in its order, starting from everything newest first", () => {
    expect(NO_FILTERS).toEqual({ place: "all", when: "all", sort: "new", with: [] });
    expect(PLACES.map((p) => [p.value, p.label])).toEqual([
      ["all", "All"],
      ["won", "Won"],
      ["second", "2nd"],
      ["third", "3rd or lower"],
      ["unfinished", "Unfinished"],
    ]);
    expect(WHENS.map((w) => [w.value, w.label])).toEqual([
      ["all", "All time"],
      ["month", "This month"],
      ["3m", "Last 3 months"],
    ]);
    expect(SORTS.map((s) => [s.value, s.label])).toEqual([
      ["new", "Newest first"],
      ["old", "Oldest first"],
      ["high", "Highest score"],
      ["low", "Lowest score"],
    ]);
  });
});

describe("filtering by place", () => {
  it("keeps everything for All, newest first", () => {
    expect(shown({})).toEqual(["won", "second", "unfinished", "practice", "third", "old"]);
  });

  it("keeps only the games with that result", () => {
    expect(shown({ place: "won" })).toEqual(["won", "practice", "old"]);
    expect(shown({ place: "second" })).toEqual(["second"]);
    expect(shown({ place: "third" })).toEqual(["third"]);
    expect(shown({ place: "unfinished" })).toEqual(["unfinished"]);
  });
});

describe("filtering by when", () => {
  it("starts this month on its first day and three months back on the same date", () => {
    expect(since("all", NOW)).toBe(0);
    expect(since("month", NOW)).toBe(new Date(2026, 10, 1).getTime());
    expect(since("3m", NOW)).toBe(new Date(2026, 7, 11).getTime());
    // Across the turn of a year.
    expect(since("3m", at(2027, 1, 2))).toBe(new Date(2026, 10, 2).getTime());
  });

  it("keeps the games from then on, the first moment included", () => {
    expect(shown({ when: "month" })).toEqual(["won", "second"]);
    expect(shown({ when: "3m" })).toEqual(["won", "second", "unfinished", "practice", "third"]);
    const onTheFirst = game("first", new Date(2026, 10, 1).getTime(), 0);
    const justBefore = game("before", new Date(2026, 10, 1).getTime() - 1, 0);
    expect(shown({ when: "month" }, [onTheFirst, justBefore])).toEqual(["first"]);
  });
});

describe("filtering by who was there", () => {
  it("keeps the games played with every one of them", () => {
    expect(shown({ with: ["Kate"] })).toEqual(["won", "unfinished", "third", "old"]);
    expect(shown({ with: ["Kate", "Dad"] })).toEqual(["third", "old"]);
    expect(shown({ with: ["Kate", "Sam"] })).toEqual([]);
  });

  it("never counts a computer that shares a person's name, nor the player", () => {
    // The practice game's computer is called Kate; it is not Kate.
    expect(shown({ with: ["Kate"] })).not.toContain("practice");
    expect(shown({ with: ["Ana"] })).toEqual([]);
  });

  it("combines with the other filters", () => {
    expect(shown({ with: ["Kate"], place: "won", when: "3m" })).toEqual(["won"]);
  });
});

describe("sorting", () => {
  it("by date either way", () => {
    expect(shown({ sort: "old" })).toEqual([
      "old",
      "third",
      "practice",
      "unfinished",
      "second",
      "won",
    ]);
  });

  it("by the player's own score either way, newest first between equal scores", () => {
    expect(shown({ sort: "high" })).toEqual([
      "won",
      "old",
      "practice",
      "second",
      "third",
      "unfinished",
    ]);
    expect(shown({ sort: "low" })).toEqual([
      "unfinished",
      "third",
      "second",
      "practice",
      "old",
      "won",
    ]);
    const a = game("a", at(2026, 1, 1), 500);
    const b = game("b", at(2026, 2, 1), 500);
    expect(shown({ sort: "high" }, [a, b])).toEqual(["b", "a"]);
    expect(shown({ sort: "low" }, [a, b])).toEqual(["b", "a"]);
  });

  it("reads the player's own seat, wherever it is", () => {
    const low = game("low", at(2026, 1, 1), 0, {
      seat: 1,
      players: [
        { seat: 0, name: "Kate", total: 9999 },
        { seat: 1, name: "Ana", total: 1 },
      ],
    });
    const high = game("high", at(2026, 1, 2), 50);
    expect(shown({ sort: "high" }, [low, high])).toEqual(["high", "low"]);
  });

  it("leaves the history it was given in its own order", () => {
    const games = [old, won];
    filterGames(games, NO_FILTERS, NOW);
    expect(games.map((g) => g.id)).toEqual(["old", "won"]);
  });
});

describe("the people to filter by", () => {
  it("are the other people, most games together first, then by name, up to the limit", () => {
    expect(companions(recent, 10).map((c) => c.name)).toEqual([
      "Kate",
      "Dad",
      "Mom",
      "Priya",
      "Sam",
    ]);
    expect(companions(recent, 2).map((c) => c.name)).toEqual(["Kate", "Dad"]);
    expect(companions([], 5)).toEqual([]);
  });

  it("each wear the picture from their latest game, whatever order the games come in", () => {
    const face = (background: "teal" | "rose") =>
      ({ background, skin: "peach", eyes: "dots", mouth: "smile", top: "none" }) as const;
    const older = game("older", at(2026, 1, 1), 0, {
      players: [
        { seat: 0, name: "Ana", total: 0 },
        { seat: 1, name: "Kate", avatar: face("teal"), total: 0 },
      ],
    });
    const newer = game("newer", at(2026, 2, 1), 0, {
      players: [
        { seat: 0, name: "Ana", total: 0 },
        { seat: 1, name: "Kate", avatar: face("rose"), total: 0 },
      ],
    });
    const middle = game("middle", at(2026, 1, 15), 0, {
      players: [
        { seat: 0, name: "Ana", total: 0 },
        { seat: 1, name: "Kate", avatar: face("teal"), total: 0 },
      ],
    });
    expect(companions([newer, older], 5)).toEqual([{ name: "Kate", avatar: face("rose") }]);
    expect(companions([older, newer], 5)).toEqual([{ name: "Kate", avatar: face("rose") }]);
    expect(companions([older, newer, middle], 5)).toEqual([{ name: "Kate", avatar: face("rose") }]);
    // Someone with no picture of their own has none here either.
    expect(companions([won], 5)).toStrictEqual([{ name: "Kate" }]);
  });

  it("toggle in and out of the filter", () => {
    expect(toggled([], "Kate")).toEqual(["Kate"]);
    expect(toggled(["Kate"], "Mom")).toEqual(["Kate", "Mom"]);
    expect(toggled(["Kate", "Mom"], "Kate")).toEqual(["Mom"]);
  });
});

describe("the count of games shown", () => {
  it("says how many, and with whom", () => {
    expect(summary(6, [])).toBe("6 games");
    expect(summary(1, [])).toBe("1 game");
    expect(summary(0, [])).toBe("0 games");
    expect(summary(1, ["Kate"])).toBe("1 game with Kate");
    expect(summary(2, ["Kate", "Mom"])).toBe("2 games with Kate and Mom");
    expect(summary(2, ["Kate", "Mom", "Dad"])).toBe("2 games with Kate, Mom and Dad");
  });
});
