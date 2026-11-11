import { describe, expect, it } from "vitest";
import type { MatchListing } from "@hf/shared";
import {
  awardsOf,
  badgeOf,
  day,
  isPractice,
  metaOf,
  mine,
  ordinal,
  points,
  resultOf,
  scoreRows,
  titleOf,
} from "./describe";

const NOV_7 = new Date(2026, 10, 7, 20, 30).getTime();

function listing(over: Partial<MatchListing> = {}): MatchListing {
  return {
    id: "m1",
    roomId: "ABC234",
    endedAt: NOV_7,
    rounds: 4,
    roundsPlayed: 4,
    finished: true,
    seat: 0,
    place: 1,
    won: true,
    preset: "east-coast",
    awards: [],
    players: [
      { seat: 0, name: "Ana", total: 14320 },
      { seat: 1, name: "Kate", total: 12905 },
      { seat: 2, name: "Mom", total: 9440 },
    ],
    ...over,
  };
}

const left = listing({
  place: null,
  won: false,
  players: [
    { seat: 0, name: "Ana", total: 500, left: true },
    { seat: 1, name: "Kate", total: 9000 },
    { seat: 2, name: "Mom", total: 7000 },
  ],
});
const unfinished = listing({ finished: false, roundsPlayed: 2, place: null, won: false });
const second = listing({ won: false, place: 2 });
const fourth = listing({
  won: false,
  place: 4,
  players: [
    { seat: 0, name: "Ana", total: 100 },
    { seat: 1, name: "Kate", total: 400 },
    { seat: 2, name: "Mom", total: 300 },
    { seat: 3, name: "Dad", total: 200 },
    { seat: 4, name: "Sam", total: 0, left: true },
  ],
});
const practice = listing({
  rounds: 3,
  roundsPlayed: 3,
  players: [
    { seat: 0, name: "Ana", total: 10050 },
    { seat: 1, name: "Robo Rita", bot: true, total: 8800 },
    { seat: 2, name: "Shuffles", bot: true, botLevel: "easy", total: 7120 },
  ],
});

describe("a past game's result", () => {
  it("is the player's own seat that counts", () => {
    expect(mine(listing({ seat: 2 })).name).toBe("Mom");
  });

  it("is won, second, third or lower, or unfinished", () => {
    expect(resultOf(listing())).toBe("won");
    expect(resultOf(second)).toBe("second");
    expect(resultOf(listing({ won: false, place: 3 }))).toBe("third");
    expect(resultOf(fourth)).toBe("third");
    expect(resultOf(unfinished)).toBe("unfinished");
  });

  it("is unfinished for a player who left, even once the others finished", () => {
    expect(left.finished).toBe(true);
    expect(resultOf(left)).toBe("unfinished");
  });
});

describe("practice games", () => {
  it("are the ones where everyone else was a computer", () => {
    expect(isPractice(listing())).toBe(false);
    expect(isPractice(practice)).toBe(true);
    // Seen from a computer's seat it would not be: only the others count.
    expect(isPractice({ ...practice, seat: 1 })).toBe(false);
    // One person among the computers is not practice.
    const mixed = listing({
      players: [...practice.players.slice(0, 2), { seat: 2, name: "Kate", total: 0 }],
    });
    expect(isPractice(mixed)).toBe(false);
    // Alone at a table is not practice against anyone.
    expect(isPractice(listing({ players: [{ seat: 0, name: "Ana", total: 0 }] }))).toBe(false);
  });
});

describe("the words on a game's card", () => {
  it("writes places as ordinals, the teens included", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111, 101].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "111th",
      "101st",
    ]);
  });

  it("titles a game by how it went, counting only those who finished", () => {
    expect(titleOf(listing())).toBe("You won");
    expect(titleOf(second)).toBe("2nd of 3");
    expect(titleOf(fourth)).toBe("4th of 4");
    expect(titleOf(unfinished)).toBe("Unfinished");
    expect(titleOf(left)).toBe("You left");
  });

  it("badges a game with its place, how far it got, or that the player left", () => {
    expect(badgeOf(listing())).toBe("1st");
    expect(badgeOf(second)).toBe("2nd");
    expect(badgeOf(fourth)).toBe("4th");
    expect(badgeOf(unfinished)).toBe("2/4");
    expect(badgeOf(left)).toBe("Left");
  });

  it("writes scores with thousands separators and dates as month and day", () => {
    expect(points(14320)).toBe("14,320");
    expect(points(-85)).toBe("-85");
    expect(points(0)).toBe("0");
    expect(day(NOV_7)).toBe("Nov 7");
  });

  it("says when, how long and under which rules", () => {
    expect(metaOf(listing())).toBe("Nov 7 · 4 rounds · East Coast");
    expect(metaOf(listing({ preset: "west-coast", rounds: 1 }))).toBe(
      "Nov 7 · 1 round · West Coast",
    );
    // A game the player left still lasted as long as the others played it.
    expect(metaOf(left)).toBe("Nov 7 · 4 rounds · East Coast");
    // Or stopped where it stopped, if the others did not finish it either.
    expect(metaOf({ ...left, finished: false, roundsPlayed: 3 })).toBe(
      "Nov 7 · stopped after round 3",
    );
  });

  it("says practice instead of the variant", () => {
    expect(metaOf(practice)).toBe("Nov 7 · practice · 3 rounds");
  });

  it("says where an unfinished game stopped", () => {
    expect(metaOf(unfinished)).toBe("Nov 7 · stopped after round 2");
    expect(metaOf({ ...unfinished, roundsPlayed: 0 })).toBe("Nov 7 · stopped in round 1");
    expect(metaOf({ ...practice, finished: false, roundsPlayed: 1, place: null })).toBe(
      "Nov 7 · practice · stopped after round 1",
    );
  });

  it("names the awards the player took home, in order, skipping any it does not know", () => {
    expect(awardsOf(listing())).toEqual([]);
    expect(awardsOf(listing({ awards: ["marva", "retired", "clean"] }))).toEqual([
      "Marva's favorite",
      "Cleanest books",
    ]);
  });
});

describe("a game's final scores", () => {
  it("lists everyone highest first, with bars against the top score", () => {
    const rows = scoreRows(second);
    expect(rows.map((r) => [r.player.name, r.you, r.share])).toEqual([
      ["Ana", true, 1],
      ["Kate", false, 12905 / 14320],
      ["Mom", false, 9440 / 14320],
    ]);
    expect(scoreRows({ ...second, seat: 1 }).map((r) => r.you)).toEqual([false, true, false]);
  });

  it("gives a negative score an empty bar, and every bar is empty when nobody scored", () => {
    const low = listing({
      players: [
        { seat: 0, name: "Ana", total: 200 },
        { seat: 1, name: "Kate", total: -50 },
      ],
    });
    expect(scoreRows(low).map((r) => r.share)).toEqual([1, 0]);
    const none = listing({
      players: [
        { seat: 0, name: "Ana", total: 0 },
        { seat: 1, name: "Kate", total: -20 },
      ],
    });
    expect(scoreRows(none).map((r) => r.share)).toEqual([0, 0]);
    expect(scoreRows(listing({ players: [] }))).toEqual([]);
  });

  it("keeps players with the same score in seat order", () => {
    const tied = listing({
      players: [
        { seat: 0, name: "Ana", total: 5 },
        { seat: 1, name: "Kate", total: 9 },
        { seat: 2, name: "Mom", total: 5 },
      ],
    });
    expect(scoreRows(tied).map((r) => r.player.name)).toEqual(["Kate", "Ana", "Mom"]);
  });

  it("leaves the listing's own order alone", () => {
    const players = [
      { seat: 0, name: "Ana", total: 1 },
      { seat: 1, name: "Kate", total: 2 },
    ];
    scoreRows(listing({ players }));
    expect(players.map((p) => p.name)).toEqual(["Ana", "Kate"]);
  });
});
