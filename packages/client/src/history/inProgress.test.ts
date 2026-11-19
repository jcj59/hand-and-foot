import { describe, it, expect } from "vitest";
import type { MatchListing, RoomInfo } from "@hf/shared";
import { EAST_COAST } from "@hf/shared";
import type { SavedGame } from "../savedGames";
import { NO_FILTERS } from "./filters";
import {
  inProgressGames,
  inProgressMeta,
  inProgressTitle,
  keepsInProgress,
  type InProgressGame,
} from "./inProgress";

const NOV_26 = new Date(2026, 10, 26, 12).getTime();

function saved(over: Partial<SavedGame> = {}): SavedGame {
  return {
    roomId: "SAV234",
    seat: 1,
    token: "t",
    savedUntil: NOV_26,
    names: ["Kate", "Ana", "Mom"],
    round: 2,
    ...over,
  };
}

function recorded(over: Partial<MatchListing> = {}): MatchListing {
  return {
    id: "m1",
    roomId: "SAV234",
    endedAt: 0,
    rounds: 4,
    roundsPlayed: 2,
    finished: false,
    seat: 0,
    place: null,
    won: false,
    preset: "east-coast",
    awards: [],
    players: [{ seat: 0, name: "Ana", total: 0 }],
    ...over,
  };
}

function room(over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    roomId: "HLD234",
    players: [
      { seat: 0, name: "Dad", connected: true },
      { seat: 1, name: "Ana", connected: true, avatar: undefined },
      { seat: 2, name: "Robo", connected: true, bot: true, botLevel: "easy" },
      { seat: 3, name: "Gone", connected: false, departed: true },
    ],
    hostSeat: 0,
    started: true,
    config: EAST_COAST,
    playAgain: [],
    nextRoundReady: [],
    ...over,
  };
}

const held = { roomId: "HLD234", seat: 1, token: "h" };
const none = { stored: null, room: null, saved: [], recorded: [] };

describe("inProgressGames", () => {
  it("is empty with no seat and nothing saved", () => {
    expect(inProgressGames(none)).toEqual([]);
  });

  it("offers the held seat first, then each saved game, with who is at the table", () => {
    const games = inProgressGames({
      ...none,
      stored: held,
      saved: [saved(), saved({ roomId: "TWO234", names: ["Ana"], seat: 0 })],
    });
    expect(games.map((g) => [g.kind, g.roomId])).toEqual([
      ["held", "HLD234"],
      ["saved", "SAV234"],
      ["saved", "TWO234"],
    ]);
    expect(games[1]!.players).toEqual([
      { name: "Kate", you: false },
      { name: "Ana", you: true },
      { name: "Mom", you: false },
    ]);
    expect(games[1]).toMatchObject({ kind: "saved", game: saved() });
  });

  it("knows who sits at the held table only from this tab's own room, leaving out who left", () => {
    expect(inProgressGames({ ...none, stored: held })[0]!.players).toBeNull();
    expect(
      inProgressGames({ ...none, stored: held, room: room({ roomId: "OTH234" }) })[0]!.players,
    ).toBeNull();
    expect(inProgressGames({ ...none, stored: held, room: room() })[0]!.players).toEqual([
      { name: "Dad", avatar: undefined, bot: undefined, botLevel: undefined, you: false },
      { name: "Ana", avatar: undefined, bot: undefined, botLevel: undefined, you: true },
      { name: "Robo", avatar: undefined, bot: true, botLevel: "easy", you: false },
    ]);
  });

  it("offers a seat at a saved game as the saved game, as Home does", () => {
    const games = inProgressGames({
      ...none,
      stored: { roomId: "SAV234", seat: 1, token: "t" },
      saved: [saved()],
    });
    expect(games.map((g) => g.kind)).toEqual(["saved"]);
  });

  it("leaves a saved game to its recorded card when the match is on record as unfinished", () => {
    expect(inProgressGames({ ...none, saved: [saved()], recorded: [recorded()] })).toEqual([]);
    // A finished match at a table with the same code is another game.
    expect(
      inProgressGames({
        ...none,
        saved: [saved()],
        recorded: [recorded({ finished: true, place: 1, won: true })],
      }),
    ).toHaveLength(1);
    expect(
      inProgressGames({ ...none, saved: [saved()], recorded: [recorded({ roomId: "OTH234" })] }),
    ).toHaveLength(1);
  });
});

describe("keepsInProgress", () => {
  const [heldGame, savedGame] = inProgressGames({ ...none, stored: held, saved: [saved()] }) as [
    InProgressGame,
    InProgressGame,
  ];
  const atRoom = inProgressGames({ ...none, stored: held, room: room() })[0]!;

  it("counts a game in progress as unfinished", () => {
    for (const place of ["all", "unfinished"] as const) {
      expect(keepsInProgress(savedGame, { ...NO_FILTERS, place })).toBe(true);
      expect(keepsInProgress(heldGame, { ...NO_FILTERS, place })).toBe(true);
    }
    for (const place of ["won", "second", "third"] as const) {
      expect(keepsInProgress(savedGame, { ...NO_FILTERS, place })).toBe(false);
      expect(keepsInProgress(heldGame, { ...NO_FILTERS, place })).toBe(false);
    }
  });

  it("is kept whenever, and in any order", () => {
    expect(keepsInProgress(savedGame, { ...NO_FILTERS, when: "month", sort: "low" })).toBe(true);
  });

  it("is kept with chosen people only when all of them are known to be at the table", () => {
    expect(keepsInProgress(savedGame, { ...NO_FILTERS, with: ["Kate"] })).toBe(true);
    expect(keepsInProgress(savedGame, { ...NO_FILTERS, with: ["Kate", "Mom"] })).toBe(true);
    expect(keepsInProgress(savedGame, { ...NO_FILTERS, with: ["Kate", "Sam"] })).toBe(false);
    // Your own name is not someone you played with.
    expect(keepsInProgress(savedGame, { ...NO_FILTERS, with: ["Ana"] })).toBe(false);
    // Nobody is known at a held seat this tab is not at.
    expect(keepsInProgress(heldGame, { ...NO_FILTERS, with: ["Kate"] })).toBe(false);
    expect(keepsInProgress(atRoom, { ...NO_FILTERS, with: ["Dad"] })).toBe(true);
    // A computer is not a person to filter by.
    expect(keepsInProgress(atRoom, { ...NO_FILTERS, with: ["Robo"] })).toBe(false);
  });
});

describe("the words on a game in progress", () => {
  const [heldGame, savedGame] = inProgressGames({ ...none, stored: held, saved: [saved()] }) as [
    InProgressGame,
    InProgressGame,
  ];

  it("names what kind of game it is", () => {
    expect(inProgressTitle(heldGame)).toBe("In progress");
    expect(inProgressTitle(savedGame)).toBe("Saved for later");
  });

  it("says which table, and how long a saved game is kept", () => {
    expect(inProgressMeta(heldGame)).toBe("Table HLD234 · your seat is waiting");
    expect(inProgressMeta(savedGame)).toBe("Table SAV234 · kept until Nov 26");
  });
});
