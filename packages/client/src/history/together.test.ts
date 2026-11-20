import { describe, expect, it } from "vitest";
import type { Avatar, MatchListing } from "@hf/shared";
import { firstName, gamesCount, stat, together, lastPlayedLine } from "./together";

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
const face = (background: Avatar["background"]): Avatar => ({
  background,
  skin: "peach",
  eyes: "dots",
  mouth: "smile",
  top: "short",
});

/** Ana (seat 0) against Kate, with these totals: Ana's first. */
function game(id: string, endedAt: number, ana: number, kate: number, over = {}): MatchListing {
  return listing({
    id,
    endedAt,
    players: [
      { seat: 0, name: "Ana", total: ana },
      { seat: 1, name: "Kate", total: kate },
    ],
    ...over,
  });
}

describe("together", () => {
  it("is null for someone never played with, or only ever met as a computer", () => {
    const bot = listing({
      players: [
        { seat: 0, name: "Ana", total: 10 },
        { seat: 1, name: "Kate", total: 20, bot: true },
      ],
    });
    expect(together([], "Kate")).toBeNull();
    expect(together([bot], "Kate")).toBeNull();
    expect(together([game("a", 1, 10, 20)], "Sam")).toBeNull();
  });

  it("never takes the player's own seat for the person, even with the same name", () => {
    const self = listing({
      players: [
        { seat: 0, name: "Kate", total: 10 },
        { seat: 1, name: "Sam", total: 5 },
      ],
    });
    expect(together([self], "Kate")).toBeNull();
  });

  it("counts games, wins, averages and bests for each side", () => {
    const recent = [
      game("a", at(2026, 10, 7), 14320, 12905, { won: true, place: 1 }),
      game("b", at(2026, 10, 3), 9000, 11000, { won: false, place: 2 }),
      game("c", at(2026, 9, 1), 5000, 6000, { won: false, place: 2 }),
    ];
    expect(together(recent, "Kate")).toEqual({
      name: "Kate",
      games: 3,
      lastPlayed: at(2026, 10, 7),
      them: { wins: 2, average: Math.round((12905 + 11000 + 6000) / 3), best: 12905 },
      you: { wins: 1, average: Math.round((14320 + 9000 + 5000) / 3), best: 14320 },
    });
  });

  it("rounds the average to a whole number", () => {
    const recent = [game("a", 1, 1, 1), game("b", 2, 2, 2)];
    expect(together(recent, "Kate")!.them.average).toBe(2);
    expect(together([...recent, game("c", 3, 2, 2)], "Kate")!.them.average).toBe(2);
  });

  it("counts a tie at the top as a win for both", () => {
    const t = together([game("a", 1, 500, 500)], "Kate")!;
    expect(t.them.wins).toBe(1);
    expect(t.you.wins).toBe(1);
  });

  it("counts an unfinished game together, but not toward wins, averages or bests", () => {
    const recent = [
      game("a", 5, 3000, 4000, { won: false, place: 2 }),
      game("b", 9, 900, 99999, { finished: false, place: null, won: false }),
    ];
    const t = together(recent, "Kate")!;
    expect(t.games).toBe(2);
    expect(t.lastPlayed).toBe(9);
    expect(t.them).toEqual({ wins: 1, average: 4000, best: 4000 });
    expect(t.you).toEqual({ wins: 0, average: 3000, best: 3000 });
  });

  it("leaves out a side that left the game, and a leaver's total from the win", () => {
    const kateLeft = listing({
      players: [
        { seat: 0, name: "Ana", total: 100 },
        { seat: 1, name: "Kate", total: 900, left: true },
      ],
    });
    const anaLeft = listing({
      won: false,
      place: null,
      players: [
        { seat: 0, name: "Ana", total: 800, left: true },
        { seat: 1, name: "Kate", total: 200 },
      ],
    });
    expect(together([kateLeft], "Kate")).toMatchObject({
      games: 1,
      them: { wins: 0, average: null, best: null },
      you: { wins: 1, average: 100, best: 100 },
    });
    expect(together([anaLeft], "Kate")).toMatchObject({
      them: { wins: 1, average: 200, best: 200 },
      you: { wins: 0, average: null, best: null },
    });
  });

  it("has no average or best before a game played to the end", () => {
    const t = together([game("a", 1, 5, 6, { finished: false, place: null })], "Kate")!;
    expect(t.them).toEqual({ wins: 0, average: null, best: null });
  });

  it("counts a third player's higher score against both", () => {
    const three = listing({
      won: false,
      place: 2,
      players: [
        { seat: 0, name: "Ana", total: 500 },
        { seat: 1, name: "Kate", total: 400 },
        { seat: 2, name: "Sam", total: 900 },
      ],
    });
    const t = together([three], "Kate")!;
    expect(t.them.wins).toBe(0);
    expect(t.you.wins).toBe(0);
  });

  it("keeps the best even when it is negative", () => {
    const t = together([game("a", 1, -50, -20), game("b", 2, -80, -90)], "Kate")!;
    expect(t.them.best).toBe(-20);
    expect(t.you.best).toBe(-50);
  });

  it("takes the picture from the latest game together, in any order", () => {
    const older = listing({
      endedAt: 1,
      players: [
        { seat: 0, name: "Ana", total: 1 },
        { seat: 1, name: "Kate", total: 1, avatar: face("teal") },
      ],
    });
    const newer = listing({
      endedAt: 2,
      players: [
        { seat: 0, name: "Ana", total: 1 },
        { seat: 1, name: "Kate", total: 1, avatar: face("rose") },
      ],
    });
    expect(together([older, newer], "Kate")!.avatar).toEqual(face("rose"));
    expect(together([newer, older], "Kate")!.avatar).toEqual(face("rose"));
    expect(together([newer, older], "Kate")!.lastPlayed).toBe(2);
    expect(together([game("a", 1, 1, 1)], "Kate")).not.toHaveProperty("avatar");
  });
});

describe("words", () => {
  it("says the first name under a face", () => {
    expect(firstName("Kate")).toBe("Kate");
    expect(firstName("Aunt May")).toBe("Aunt");
    expect(firstName("  Mom  ")).toBe("Mom");
  });

  it("counts games", () => {
    expect(gamesCount(1)).toBe("1 game");
    expect(gamesCount(0)).toBe("0 games");
    expect(gamesCount(12)).toBe("12 games");
  });

  it("says when the last game together was", () => {
    const t = together(
      [game("a", at(2026, 10, 7), 1, 1), game("b", at(2026, 9, 2), 1, 1)],
      "Kate",
    )!;
    expect(lastPlayedLine(t)).toBe("Last played Nov 7");
  });

  it("writes a total, or a dash before there is one", () => {
    expect(stat(null)).toBe("–");
    expect(stat(12905)).toBe("12,905");
    expect(stat(0)).toBe("0");
  });
});
