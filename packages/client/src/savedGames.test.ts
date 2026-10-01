import { describe, it, expect } from "vitest";
import { EAST_COAST, type RoomInfo } from "@hf/shared";
import type { CredentialStore } from "./credentials";
import {
  forgetSavedGame,
  loadSavedGames,
  noteRoom,
  rememberSavedGame,
  SAVED_GAMES_KEY,
  savedGamesStore,
  type SavedGame,
} from "./savedGames";

/** An in-memory stand-in for localStorage. */
function memoryStore(initial: Record<string, string> = {}): CredentialStore & {
  readonly data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A store that throws on every operation, like one in a locked-down browser. */
function hostileStore(): CredentialStore {
  const no = (): never => {
    throw new Error("blocked");
  };
  return { getItem: no, setItem: no, removeItem: no };
}

const game = (roomId: string, savedUntil: number, over: Partial<SavedGame> = {}): SavedGame => ({
  roomId,
  seat: 1,
  token: `tok-${roomId}`,
  savedUntil,
  names: ["ana", "ben"],
  round: 2,
  ...over,
});

function room(over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    roomId: "ABC234",
    players: [
      { seat: 0, name: "ana", connected: true },
      { seat: 1, name: "ben", connected: false },
    ],
    hostSeat: 0,
    started: true,
    savedUntil: 5_000,
    config: EAST_COAST,
    playAgain: [],
    nextRoundReady: [],
    ...over,
  };
}

const seat = { roomId: "ABC234", seat: 1, token: "tok" };

describe("the list of saved games", () => {
  it("reads back what was remembered, soonest to close first, under its own key", () => {
    const store = memoryStore();
    rememberSavedGame(game("LATE22", 9_000), store);
    rememberSavedGame(game("SOON22", 1_000), store);
    expect(loadSavedGames(store).map((g) => g.roomId)).toEqual(["SOON22", "LATE22"]);
    expect(Object.keys(store.data)).toEqual([SAVED_GAMES_KEY]);
  });

  it("keeps one entry per table, the latest", () => {
    const store = memoryStore();
    rememberSavedGame(game("ABC234", 1_000), store);
    rememberSavedGame(game("ABC234", 2_000, { round: 3 }), store);
    expect(loadSavedGames(store)).toEqual([game("ABC234", 2_000, { round: 3 })]);
  });

  it("forgets one table and leaves the rest, removing the key once empty", () => {
    const store = memoryStore();
    rememberSavedGame(game("ONE222", 1_000), store);
    rememberSavedGame(game("TWO222", 2_000), store);
    forgetSavedGame("ONE222", store);
    expect(loadSavedGames(store).map((g) => g.roomId)).toEqual(["TWO222"]);
    forgetSavedGame("NOPE22", store);
    expect(loadSavedGames(store)).toHaveLength(1);
    forgetSavedGame("TWO222", store);
    expect(store.data).toEqual({});
  });

  it("drops entries that are malformed, and a list that is not one", () => {
    const good = game("GOOD22", 1_000);
    const bad = [
      null,
      "x",
      { ...good, roomId: "" },
      { ...good, roomId: 5 },
      { ...good, token: "" },
      { ...good, token: 5 },
      { ...good, seat: -1 },
      { ...good, seat: 1.5 },
      { ...good, savedUntil: "soon" },
      { ...good, names: "ana" },
      { ...good, names: [1] },
      { ...good, round: 1.5 },
    ];
    const store = memoryStore({ [SAVED_GAMES_KEY]: JSON.stringify([...bad, good]) });
    expect(loadSavedGames(store)).toEqual([good]);
    expect(loadSavedGames(memoryStore({ [SAVED_GAMES_KEY]: "{}" }))).toEqual([]);
    expect(loadSavedGames(memoryStore({ [SAVED_GAMES_KEY]: "not json" }))).toEqual([]);
  });

  it("keeps only the fields it knows", () => {
    const store = memoryStore({
      [SAVED_GAMES_KEY]: JSON.stringify([{ ...game("ABC234", 1), extra: "no" }]),
    });
    expect(loadSavedGames(store)).toEqual([game("ABC234", 1)]);
  });

  it("survives a browser that blocks storage, or has none", () => {
    expect(loadSavedGames(hostileStore())).toEqual([]);
    expect(() => rememberSavedGame(game("ABC234", 1), hostileStore())).not.toThrow();
    expect(loadSavedGames(null)).toEqual([]);
    expect(() => rememberSavedGame(game("ABC234", 1), null)).not.toThrow();
  });

  it("reaches localStorage in a browser, and nothing where it is blocked", () => {
    expect(savedGamesStore()).toBe(window.localStorage);
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    try {
      expect(savedGamesStore()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("keeping the list in step with the server", () => {
  it("remembers the seated table while it is saved, with who plays and the round", () => {
    const store = memoryStore();
    noteRoom(room(), seat, 3, store);
    expect(loadSavedGames(store)).toEqual([
      { ...seat, savedUntil: 5_000, names: ["ana", "ben"], round: 3 },
    ]);
  });

  it("keeps the round it knew when the news carries none, and starts at one", () => {
    const store = memoryStore();
    noteRoom(room(), seat, null, store);
    expect(loadSavedGames(store)[0]!.round).toBe(1);
    noteRoom(room(), seat, 4, store);
    noteRoom(room({ savedUntil: 6_000 }), seat, null, store);
    expect(loadSavedGames(store)[0]).toMatchObject({ round: 4, savedUntil: 6_000 });
  });

  it("forgets it once it is being played again", () => {
    const store = memoryStore();
    noteRoom(room(), seat, 3, store);
    noteRoom(room({ savedUntil: null }), seat, 3, store);
    expect(loadSavedGames(store)).toEqual([]);
    noteRoom(room(), seat, 3, store);
    noteRoom(room({ savedUntil: undefined }), seat, 3, store);
    // Forgotten outright, not written back as an entry with no date.
    expect(store.data).toEqual({});
  });

  it("ignores another table, a lobby, and a tab with no seat", () => {
    const store = memoryStore();
    rememberSavedGame(game("ABC234", 1_000), store);
    noteRoom(room({ roomId: "OTHER2", savedUntil: null }), seat, 1, store);
    noteRoom(room({ started: false, savedUntil: null }), seat, 1, store);
    noteRoom(room({ savedUntil: null }), null, 1, store);
    expect(loadSavedGames(store)).toEqual([game("ABC234", 1_000)]);
  });
});
