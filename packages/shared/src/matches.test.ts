import { describe, it, expect } from "vitest";
import { EAST_COAST, WEST_COAST } from "./rules";
import {
  awardsWon,
  historyFor,
  listingFor,
  RECENT_MATCHES,
  replayFor,
  seatOf,
  statsFor,
  type MatchRecord,
  type SeatTally,
} from "./matches";

const tally = (over: Partial<SeatTally> = {}): SeatTally => ({
  pilesTaken: 0,
  grabbyPants: 0,
  marvaRules: 0,
  wentOut: 0,
  cleanBooks: 0,
  dirtyBooks: 0,
  ...over,
});

/** Ana (user "u-ana") and Ben (no identity) and a computer, four rounds by default. */
function record(
  over: Omit<Partial<MatchRecord>, "summary"> & { summary?: Partial<MatchRecord["summary"]> } = {},
): MatchRecord {
  const { summary, ...rest } = over;
  return {
    id: "m1",
    roomId: "ABC234",
    startedAt: 1_000,
    endedAt: 2_000,
    config: EAST_COAST,
    seed: 1,
    firstSeat: 0,
    seats: [
      { seat: 0, name: "Ana", userId: "u-ana" },
      { seat: 1, name: "Ben" },
      { seat: 2, name: "Robo Rita", bot: true },
    ],
    log: [],
    summary: {
      roundsPlayed: 4,
      rounds: [
        [100, 200, 50],
        [300, -50, 10],
        [900, 400, 20],
        [-100, 600, 30],
      ],
      totals: [1200, 1150, 110],
      finished: true,
      winners: [0],
      departed: [],
      tallies: [
        tally({ grabbyPants: 1, marvaRules: 2, wentOut: 1, cleanBooks: 3 }),
        tally(),
        tally(),
      ],
      ...summary,
    },
    ...rest,
  };
}

describe("a player's seat in a match", () => {
  it("is found by their identity, never for a computer", () => {
    expect(seatOf(record(), "u-ana")).toBe(0);
    expect(seatOf(record(), "u-nobody")).toBeNull();
    const botWithId = record({
      seats: [
        { seat: 0, name: "Ana" },
        { seat: 1, name: "Robo", userId: "u-ana", bot: true },
      ],
    });
    expect(seatOf(botWithId, "u-ana")).toBeNull();
  });
});

describe("a match in a player's list", () => {
  it("shows the table's names and totals, where they came, and no identities", () => {
    const listing = listingFor(record(), "u-ana")!;
    expect(listing).toMatchObject({
      id: "m1",
      roomId: "ABC234",
      endedAt: 2_000,
      rounds: 4,
      roundsPlayed: 4,
      finished: true,
      seat: 0,
      place: 1,
      won: true,
      preset: "east-coast",
      awards: ["grabby", "marva", "clean", "out"],
    });
    expect(listing.players).toEqual([
      { seat: 0, name: "Ana", total: 1200 },
      { seat: 1, name: "Ben", total: 1150 },
      { seat: 2, name: "Robo Rita", bot: true, total: 110 },
    ]);
    expect(JSON.stringify(listing)).not.toContain("u-ana");
  });

  it("places a player below everyone who beat them, sharing a place on a tie", () => {
    const tied = record({ summary: { totals: [1150, 1150, 1300], winners: [2] } });
    expect(listingFor(tied, "u-ana")).toMatchObject({ place: 2, won: false });
  });

  it("places a player only among those who finished, past anyone who left ahead of them", () => {
    const m = record({
      summary: { totals: [1000, 3000, 900], departed: [{ seat: 1, afterRound: 2 }], winners: [0] },
    });
    expect(listingFor(m, "u-ana")).toMatchObject({ place: 1, won: true });
  });

  it("calls a share of a tied win a win, whoever is named first", () => {
    const tied = record({ summary: { totals: [1200, 1200, 0], winners: [1, 0] } });
    expect(listingFor(tied, "u-ana")).toMatchObject({ place: 1, won: true });
  });

  it("gives no place in an unfinished match, nor to a player who left", () => {
    expect(
      listingFor(record({ summary: { finished: false, winners: [] } }), "u-ana")!.place,
    ).toBeNull();
    const left = record({ summary: { departed: [{ seat: 0, afterRound: 2 }], winners: [1] } });
    const listing = listingFor(left, "u-ana")!;
    expect(listing.place).toBeNull();
    expect(listing.players[0]).toMatchObject({ left: true });
  });

  it("is not there for someone who did not play", () => {
    expect(listingFor(record(), "u-other")).toBeNull();
  });
});

describe("a player's stats", () => {
  it("counts matches, wins, the average and best totals, and the best round", () => {
    const lost = record({
      id: "m2",
      summary: {
        totals: [800, 1150, 110],
        winners: [1],
        rounds: [[800, 1150, 110]],
        roundsPlayed: 1,
      },
    });
    const stats = statsFor([record(), lost], "u-ana");
    expect(stats).toMatchObject({
      played: 2,
      wins: 1,
      unfinished: 0,
      averageScore: 1000,
      bestMatch: 1200,
      bestRound: 900,
      roundsPlayed: 5,
      grabbyPants: 2,
      marvaRules: 4,
      wentOut: 2,
      cleanBooks: 6,
      dirtyBooks: 0,
    });
  });

  it("counts an unfinished match's rounds, but not as played or won", () => {
    const stats = statsFor(
      [
        record({
          summary: { finished: false, winners: [], rounds: [[1500, 0, 0]], roundsPlayed: 1 },
        }),
      ],
      "u-ana",
    );
    expect(stats).toMatchObject({
      played: 0,
      wins: 0,
      unfinished: 1,
      averageScore: null,
      bestMatch: null,
      bestRound: 1500,
      roundsPlayed: 1,
    });
  });

  it("counts a match the player left only as far as they played it", () => {
    const left = record({ summary: { departed: [{ seat: 0, afterRound: 2 }], winners: [1] } });
    const stats = statsFor([left], "u-ana");
    expect(stats).toMatchObject({
      played: 0,
      wins: 0,
      unfinished: 0,
      roundsPlayed: 2,
      bestRound: 300,
    });
  });

  it("is all zeros, with nothing to average, before the first match", () => {
    expect(statsFor([], "u-ana")).toEqual({
      played: 0,
      wins: 0,
      unfinished: 0,
      averageScore: null,
      bestMatch: null,
      bestRound: null,
      roundsPlayed: 0,
      grabbyPants: 0,
      marvaRules: 0,
      wentOut: 0,
      cleanBooks: 0,
      dirtyBooks: 0,
      pilesTaken: 0,
      redThreesEaten: 0,
      awards: { grabby: 0, marva: 0, clean: 0, out: 0, pile: 0, "red-threes": 0 },
    });
  });

  it("counts how many matches gave the player each award", () => {
    const a = record({ id: "a" });
    const b = record({
      id: "b",
      summary: { tallies: [tally({ pilesTaken: 4 }), tally({ pilesTaken: 4 }), tally()] },
    });
    // Unfinished: no awards, however the tallies look.
    const c = record({ id: "c", summary: { finished: false, winners: [] } });
    const again = record({
      id: "again",
      summary: { tallies: [tally({ wentOut: 1 }), tally(), tally()] },
    });
    expect(statsFor([a, b, c, again], "u-ana").awards).toEqual({
      grabby: 1,
      marva: 1,
      clean: 1,
      out: 2,
      pile: 1,
      "red-threes": 0,
    });
  });

  it("ignores matches the player was not in", () => {
    expect(statsFor([record()], "u-other").played).toBe(0);
  });

  it("rounds the average to a whole number", () => {
    const a = record({ id: "a", summary: { totals: [1001, 0, 0] } });
    const b = record({ id: "b", summary: { totals: [1000, 0, 0] } });
    expect(statsFor([a, b], "u-ana").averageScore).toBe(1001);
  });
});

describe("a player's history", () => {
  it("lists their matches newest first, up to the limit, and counts them all", () => {
    expect(RECENT_MATCHES).toBe(100);
    const records = Array.from({ length: 105 }, (_, i) => record({ id: `m${i}`, endedAt: i }));
    const history = historyFor(
      [...records, record({ id: "x", seats: [{ seat: 0, name: "Zed" }] })],
      "u-ana",
    );
    expect(history.recent).toHaveLength(100);
    expect(history.recent[0]!.id).toBe("m104");
    expect(history.recent.at(-1)!.id).toBe("m5");
    expect(history.stats.played).toBe(105);
  });
});

describe("a match to watch again", () => {
  it("is the whole record for one of its players, their seat named, and no identities", () => {
    const replay = replayFor(record(), "u-ana")!;
    expect(replay.seat).toBe(0);
    expect(replay.log).toEqual(record().log);
    expect(replay.seats).toEqual([
      { seat: 0, name: "Ana" },
      { seat: 1, name: "Ben" },
      { seat: 2, name: "Robo Rita", bot: true },
    ]);
    expect(JSON.stringify(replay)).not.toContain("u-ana");
  });

  it("is nothing for someone who did not play it", () => {
    expect(replayFor(record(), "u-other")).toBeNull();
  });
});

describe("the awards a player won in a match", () => {
  it("are those the table gave them, shared on a tie, none for doing nothing", () => {
    const tied = record({
      summary: {
        tallies: [tally({ pilesTaken: 2, cleanBooks: 1 }), tally({ pilesTaken: 2 }), tally()],
      },
    });
    expect(awardsWon(tied, 0)).toEqual(["clean", "pile"]);
    expect(awardsWon(tied, 1)).toEqual(["pile"]);
    expect(awardsWon(tied, 2)).toEqual([]);
  });

  it("are none in a match that did not finish", () => {
    expect(awardsWon(record({ summary: { finished: false, winners: [] } }), 0)).toEqual([]);
  });

  it("leave out a player who left, so the award goes to the best of those who stayed", () => {
    const leftEarly = record({
      summary: {
        departed: [{ seat: 1, afterRound: 2 }],
        tallies: [tally({ pilesTaken: 1 }), tally({ pilesTaken: 5 }), tally()],
      },
    });
    expect(awardsWon(leftEarly, 1)).toEqual([]);
    expect(awardsWon(leftEarly, 0)).toEqual(["pile"]);
  });
});

describe("the variant a listed match was played under", () => {
  it("is its preset, read from the rules it kept", () => {
    expect(listingFor(record({ config: WEST_COAST }), "u-ana")!.preset).toBe("west-coast");
    // Rules kept before the preset was recorded are told apart by the wild ratio.
    const { preset: _p, ...older } = WEST_COAST;
    void _p;
    expect(listingFor(record({ config: older }), "u-ana")!.preset).toBe("west-coast");
  });
});
