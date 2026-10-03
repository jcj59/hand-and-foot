import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Ack, SeatCredentials } from "@hf/shared";
import {
  createTable,
  joinTable,
  leaveTable,
  closedNotice,
  pauseTable,
  saveTableForLater,
  sendReaction,
  play,
  reclaimOnReconnect,
  reclaimSeat,
  carryOnWithout,
  followRematch,
  resumeSavedGame,
  SAVED_GAME_GONE,
  startTable,
  type ActionSink,
} from "./actions";
import { CREDENTIALS_KEY, loadCredentials, saveCredentials } from "./credentials";
import { loadSavedGames, rememberSavedGame } from "./savedGames";
import { ACK_TIMEOUT_MS, NO_RESPONSE, type HfClientSocket } from "./socket";

/** A socket that records what was sent and answers with a queued ack. */
function fakeSocket(answers: Ack<unknown>[]): {
  socket: HfClientSocket;
  readonly sent: { event: string; args: unknown[] }[];
} {
  const sent: { event: string; args: unknown[] }[] = [];
  const queue = [...answers];
  const socket = {
    emit: (event: string, ...args: unknown[]) => {
      const ack = args[args.length - 1] as (result: Ack<unknown>) => void;
      sent.push({ event, args: args.slice(0, -1) });
      ack(queue.shift() ?? { ok: true, data: undefined });
      return socket;
    },
  } as unknown as HfClientSocket;
  return { socket, sent };
}

function sink(): ActionSink & {
  readonly seated: SeatCredentials[];
  readonly notices: (string | null)[];
} {
  const seated: SeatCredentials[] = [];
  const notices: (string | null)[] = [];
  return {
    seated,
    notices,
    seat: (credentials) => seated.push(credentials),
    setNotice: (notice) => notices.push(notice),
  };
}

const credentials: SeatCredentials = { roomId: "ABC234", seat: 0, token: "tok" };

beforeEach(() => {
  window.localStorage.removeItem(CREDENTIALS_KEY);
});

describe("createTable", () => {
  it("returns the room id and takes the seat", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: credentials }]);
    const target = sink();
    expect(await createTable(socket, "ana", { preset: "east-coast", mode: "family" }, target)).toBe(
      "ABC234",
    );
    expect(sent[0].event).toBe("createRoom");
    expect(target.seated).toEqual([credentials]);
  });

  it("trims the name before sending it", async () => {
    // A trailing space would otherwise show in the seat list forever.
    const { socket, sent } = fakeSocket([{ ok: true, data: credentials }]);
    await createTable(socket, "  ana  ", { mode: "family" }, sink());
    expect(sent[0].args).toEqual([{ name: "ana", options: { mode: "family" } }]);
  });

  it("passes the chosen rules through", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: credentials }]);
    await createTable(socket, "ana", { preset: "west-coast", mode: "competitive" }, sink());
    expect(sent[0].args[0]).toMatchObject({
      options: { preset: "west-coast", mode: "competitive" },
    });
  });

  it("clears any stale notice once it succeeds", async () => {
    // Otherwise the error from a failed attempt hangs over the table they just made.
    const { socket } = fakeSocket([{ ok: true, data: credentials }]);
    const target = sink();
    await createTable(socket, "ana", {}, target);
    expect(target.notices).toEqual([null]);
  });

  it("reports a refusal and takes no seat", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "a table seats at most 8" }]);
    const target = sink();
    expect(await createTable(socket, "ana", {}, target)).toBeNull();
    expect(target.seated).toEqual([]);
    expect(target.notices).toEqual(["a table seats at most 8"]);
  });
});

describe("joinTable", () => {
  it("normalizes the code before sending it", async () => {
    // So a code typed in lower case, or pasted with a dash, still finds the table.
    const { socket, sent } = fakeSocket([{ ok: true, data: { ...credentials, seat: 1 } }]);
    expect(await joinTable(socket, " abc-234 ", "ben", sink())).toBe("ABC234");
    expect(sent[0].args).toEqual([{ roomId: "ABC234", name: "ben" }]);
  });

  it("trims the name before sending it", async () => {
    // Same reason as createTable: a stray space would show in the seat list for the
    // rest of the game. Asserted separately because the two paths trim separately.
    const { socket, sent } = fakeSocket([{ ok: true, data: { ...credentials, seat: 1 } }]);
    await joinTable(socket, "ABC234", "  ben  ", sink());
    expect(sent[0].args).toEqual([{ roomId: "ABC234", name: "ben" }]);
  });

  it("takes the seat the server assigned, not the one it asked for", async () => {
    const granted: SeatCredentials = { roomId: "ABC234", seat: 3, token: "t3" };
    const { socket } = fakeSocket([{ ok: true, data: granted }]);
    const target = sink();
    await joinTable(socket, "ABC234", "ben", target);
    expect(target.seated).toEqual([granted]);
  });

  it("surfaces an unknown code as a notice", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "no room with that code" }]);
    const target = sink();
    expect(await joinTable(socket, "ABC234", "ben", target)).toBeNull();
    expect(target.notices).toEqual(["no room with that code"]);
  });
});

describe("reclaimSeat", () => {
  it("keeps the seat when the server honours the token", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: credentials }]);
    const target = sink();
    saveCredentials(credentials);
    expect(await reclaimSeat(socket, credentials, target)).toBe("reclaimed");
    expect(sent[0]).toEqual({ event: "resumeSeat", args: [credentials] });
    expect(target.seated).toEqual([credentials]);
  });

  it("takes the seat number from the server, not from what was stored", async () => {
    // Someone ahead of this player left the lobby while they were away, and the
    // seats closed up. The stored number now names somebody else's seat.
    const moved: SeatCredentials = { ...credentials, seat: 1 };
    const { socket } = fakeSocket([{ ok: true, data: moved }]);
    const target = sink();
    expect(await reclaimSeat(socket, { ...credentials, seat: 2 }, target)).toBe("reclaimed");
    expect(target.seated).toEqual([moved]);
  });

  it("discards the credentials when the seat is gone", async () => {
    // Expected rather than exceptional: the round may have finished, the room may
    // have been reaped, or the token may predate a restart. Keeping them would
    // retry a doomed reclaim on every load.
    const { socket } = fakeSocket([{ ok: false, error: "that seat is not yours" }]);
    const target = sink();
    saveCredentials(credentials);
    expect(await reclaimSeat(socket, credentials, target)).toBe("gone");
    expect(loadCredentials()).toBeNull();
    expect(target.seated).toEqual([]);
  });

  it("tells a seat that is gone from a server that did not answer", async () => {
    // They call for opposite responses: gone credentials are dead, but a slow
    // network is no reason to throw a player out of a game.
    vi.useFakeTimers();
    try {
      saveCredentials(credentials);
      const silent = { emit: () => silent } as unknown as HfClientSocket;
      const pending = reclaimSeat(silent, credentials, sink());
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
      expect(await pending).toBe("unreachable");
      expect(loadCredentials()).toEqual(credentials);
    } finally {
      vi.useRealTimers();
    }
    const { socket } = fakeSocket([{ ok: false, error: "no room with that code" }]);
    expect(await reclaimSeat(socket, credentials, sink())).toBe("gone");
    expect(loadCredentials()).toBeNull();
  });
});

describe("a seat the match went on without", () => {
  it("is gone, and said so, rather than taken for a table that has gone", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "the game carried on without you" }]);
    saveCredentials(credentials);
    expect(await reclaimSeat(socket, credentials, sink())).toBe("removed");
    expect(loadCredentials()).toBeNull();
  });

  it("is the notice on a reconnect", async () => {
    const { socket, sent } = fakeSocket([{ ok: false, error: "the game carried on without you" }]);
    const handlers = new Set<() => void>();
    Object.assign(socket, {
      on: (_event: "connect", handler: () => void) => handlers.add(handler),
      off: (_event: "connect", handler: () => void) => handlers.delete(handler),
    });
    const left: number[] = [];
    const target = { ...sink(), credentials: () => credentials, leave: () => left.push(1) };
    reclaimOnReconnect(socket, target);
    handlers.forEach((handler) => handler());
    await vi.waitFor(() => expect(left).toHaveLength(1));
    expect(sent).toHaveLength(1);
    expect(target.notices).toEqual(["the game carried on without you"]);
  });

  it("is the notice for a saved game too", async () => {
    const game = { ...credentials, savedUntil: 9e15, names: ["ana"], round: 2 };
    rememberSavedGame(game);
    const { socket } = fakeSocket([{ ok: false, error: "the game carried on without you" }]);
    const target = sink();
    expect(await resumeSavedGame(socket, game, target)).toBe(false);
    expect(target.notices).toEqual(["the game carried on without you"]);
    expect(loadSavedGames()).toEqual([]);
  });
});

describe("carryOnWithout", () => {
  it("asks the server, and clears any notice once it has", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: undefined }]);
    const target = sink();
    expect(await carryOnWithout(socket, 2, target)).toBe(true);
    expect(sent).toEqual([{ event: "removePlayer", args: [{ seat: 2 }] }]);
    expect(target.notices).toEqual([null]);
  });

  it("puts a refusal on the store", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "cy is still at the table" }]);
    const target = sink();
    expect(await carryOnWithout(socket, 2, target)).toBe(false);
    expect(target.notices).toEqual(["cy is still at the table"]);
  });
});

describe("resumeSavedGame", () => {
  const game = { ...credentials, savedUntil: 9e15, names: ["ana"], round: 2 };

  it("sends only the seat, and sits in the one the server resolved", async () => {
    const resolved = { ...credentials, seat: 1 };
    const { socket, sent } = fakeSocket([{ ok: true, data: resolved }]);
    const target = sink();
    expect(await resumeSavedGame(socket, game, target)).toBe(true);
    expect(sent).toEqual([{ event: "resumeSeat", args: [credentials] }]);
    expect(target.seated).toEqual([resolved]);
    expect(target.notices).toEqual([null]);
  });

  it("keeps a saved game the server did not answer about, and says so", async () => {
    rememberSavedGame(game);
    vi.useFakeTimers();
    try {
      const silent = { emit: () => silent } as unknown as HfClientSocket;
      const target = sink();
      const pending = resumeSavedGame(silent, game, target);
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
      expect(await pending).toBe(false);
      expect(target.notices).toEqual([NO_RESPONSE]);
    } finally {
      vi.useRealTimers();
    }
    expect(loadSavedGames()).toEqual([game]);
  });

  it("forgets a saved game that is gone, and only that, not the stored seat", async () => {
    rememberSavedGame(game);
    const elsewhere = { roomId: "OTHER2", seat: 0, token: "x" };
    saveCredentials(elsewhere);
    const { socket } = fakeSocket([{ ok: false, error: "no room with that code" }]);
    const target = sink();
    expect(await resumeSavedGame(socket, game, target)).toBe(false);
    expect(target.notices).toEqual([SAVED_GAME_GONE]);
    expect(loadSavedGames()).toEqual([]);
    expect(loadCredentials()).toEqual(elsewhere);
  });
});

describe("reclaimOnReconnect", () => {
  /** A socket whose `connect` the test fires, answering requests from a queue. */
  function reconnecting(answers: Ack<unknown>[]): {
    socket: HfClientSocket;
    connect(): void;
    readonly sent: { event: string; args: unknown[] }[];
    readonly listening: () => number;
  } {
    const { socket, sent } = fakeSocket(answers);
    const handlers = new Set<() => void>();
    Object.assign(socket, {
      on: (_event: "connect", handler: () => void) => handlers.add(handler),
      off: (_event: "connect", handler: () => void) => handlers.delete(handler),
    });
    return {
      socket,
      sent,
      connect: () => handlers.forEach((handler) => handler()),
      listening: () => handlers.size,
    };
  }

  function store(held: SeatCredentials | null): ReturnType<typeof sink> & {
    credentials(): SeatCredentials | null;
    leave(): void;
    readonly left: number[];
  } {
    const left: number[] = [];
    return { ...sink(), left, credentials: () => held, leave: () => left.push(1) };
  }

  it("asks for the held seat back on every reconnect", async () => {
    const { socket, sent, connect } = reconnecting([
      { ok: true, data: credentials },
      { ok: true, data: credentials },
    ]);
    const target = store(credentials);
    reclaimOnReconnect(socket, target);
    connect();
    connect();
    await vi.waitFor(() => expect(target.seated).toHaveLength(2));
    expect(sent).toEqual([
      { event: "resumeSeat", args: [credentials] },
      { event: "resumeSeat", args: [credentials] },
    ]);
  });

  it("stays quiet with no seat held, as on a fresh load", () => {
    const { socket, sent, connect } = reconnecting([]);
    reclaimOnReconnect(socket, store(null));
    connect();
    expect(sent).toEqual([]);
  });

  it("leaves the table with a notice when the seat is gone", async () => {
    const { socket, connect } = reconnecting([{ ok: false, error: "no room with that code" }]);
    const target = store(credentials);
    reclaimOnReconnect(socket, target);
    connect();
    await vi.waitFor(() => expect(target.left).toHaveLength(1));
    expect(target.notices).toEqual(["that table is no longer available"]);
  });

  it("keeps the seat when the server does not answer, for the next reconnect to retry", async () => {
    vi.useFakeTimers();
    try {
      const target = store(credentials);
      const handlers = new Set<() => void>();
      const silent = {
        emit: () => silent,
        on: (_event: string, handler: () => void) => handlers.add(handler),
        off: (_event: string, handler: () => void) => handlers.delete(handler),
      } as unknown as HfClientSocket;
      reclaimOnReconnect(silent, target);
      handlers.forEach((handler) => handler());
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
      expect(target.left).toEqual([]);
      expect(target.notices).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("detaches its listener", () => {
    const { socket, listening } = reconnecting([]);
    const detach = reclaimOnReconnect(socket, store(credentials));
    expect(listening()).toBe(1);
    detach();
    expect(listening()).toBe(0);
  });
});

describe("leaveTable", () => {
  function leaver(): { leave(): void; readonly left: number[] } {
    const left: number[] = [];
    return { left, leave: () => left.push(1) };
  }

  it("tells the server, then forgets the seat", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: undefined }]);
    const target = leaver();
    await leaveTable(socket, target);
    expect(sent).toEqual([{ event: "leaveRoom", args: [] }]);
    expect(target.left).toHaveLength(1);
  });

  it("forgets the seat even when the server refuses", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "you are not seated in a room" }]);
    const target = leaver();
    await leaveTable(socket, target);
    expect(target.left).toHaveLength(1);
  });

  it("forgets the seat even when the server never answers", async () => {
    vi.useFakeTimers();
    try {
      const socket = { emit: () => socket } as unknown as HfClientSocket;
      const target = leaver();
      const leaving = leaveTable(socket, target);
      expect(target.left).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
      await leaving;
      expect(target.left).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startTable", () => {
  it("reports success", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: undefined }]);
    expect(await startTable(socket, sink())).toBe(true);
    expect(sent[0].event).toBe("startGame");
  });

  it("surfaces the server's reason for refusing", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "a game needs at least 2 players" }]);
    const target = sink();
    expect(await startTable(socket, target)).toBe(false);
    expect(target.notices).toEqual(["a game needs at least 2 players"]);
  });
});

describe("play", () => {
  it("sends the action unchanged", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: undefined }]);
    expect(await play(socket, { type: "draw" }, sink())).toBe(true);
    expect(sent[0]).toEqual({ event: "submitAction", args: [{ type: "draw" }] });
  });

  it("puts a rule violation on the store for the table to show", async () => {
    // Engine errors are written for a player to read, so they are surfaced verbatim.
    const { socket } = fakeSocket([
      { ok: false, error: "you must play at least one card taken from the pile before discarding" },
    ]);
    const target = sink();
    expect(await play(socket, { type: "discard", cardId: "c1" }, target)).toBe(false);
    expect(target.notices).toEqual([
      "you must play at least one card taken from the pile before discarding",
    ]);
  });
});

describe("pauseTable", () => {
  it("freezes and restarts the clock", async () => {
    const { socket, sent } = fakeSocket([
      { ok: true, data: undefined },
      { ok: true, data: undefined },
    ]);
    await pauseTable(socket, true, sink());
    await pauseTable(socket, false, sink());
    expect(sent.map((s) => s.args[0])).toEqual([{ paused: true }, { paused: false }]);
  });

  it("reports the refusal at a competitive table", async () => {
    const { socket } = fakeSocket([{ ok: false, error: "pausing is disabled in this mode" }]);
    const target = sink();
    expect(await pauseTable(socket, true, target)).toBe(false);
    expect(target.notices).toEqual(["pausing is disabled in this mode"]);
  });
});

describe("saveTableForLater", () => {
  it("asks for the table to be kept, and reports a refusal", async () => {
    const { socket, sent } = fakeSocket([
      { ok: true, data: undefined },
      { ok: false, error: "pause the table before saving it for later" },
    ]);
    const target = sink();
    expect(await saveTableForLater(socket, target)).toBe(true);
    expect(await saveTableForLater(socket, target)).toBe(false);
    expect(sent.map((s) => s.event)).toEqual(["saveForLater", "saveForLater"]);
    expect(target.notices).toEqual([null, "pause the table before saving it for later"]);
  });
});

describe("closedNotice", () => {
  it("says why a table closed, for each reason", () => {
    expect(closedNotice("paused")).toBe("The table was closed after being paused for 30 minutes.");
    expect(closedNotice("saved")).toBe(
      "The saved game was closed after a week without being picked up.",
    );
    expect(closedNotice("abandoned")).toBe("The table was closed because everyone had left.");
  });
});

describe("sending a reaction", () => {
  it("asks the server with the reaction's id, and says whether it went", async () => {
    const sent: unknown[] = [];
    const answers = [
      { ok: true, data: undefined },
      { ok: false, error: "too many reactions" },
    ];
    const socket = {
      emit: (event: string, payload: unknown, ack: (a: unknown) => void) => {
        sent.push([event, payload]);
        ack(answers.shift());
      },
    } as unknown as HfClientSocket;
    expect(await sendReaction(socket, "nice")).toBe(true);
    expect(await sendReaction(socket, "nice")).toBe(false);
    expect(sent).toEqual([
      ["react", { id: "nice" }],
      ["react", { id: "nice" }],
    ]);
  });
});

describe("followRematch", () => {
  function listening(answers: Ack<unknown>[]) {
    const { socket, sent } = fakeSocket(answers);
    const handlers = new Set<(seat: SeatCredentials) => void>();
    Object.assign(socket, {
      on: (_event: "rematch", handler: (seat: SeatCredentials) => void) => handlers.add(handler),
      off: (_event: "rematch", handler: (seat: SeatCredentials) => void) =>
        handlers.delete(handler),
    });
    return {
      socket,
      sent,
      fire: (seat: SeatCredentials) => handlers.forEach((h) => h(seat)),
      handlers,
    };
  }

  it("takes the seat the host's rematch sent, and goes to its table", async () => {
    const seat = { roomId: "NXT234", seat: 1, token: "n1" };
    const { socket, sent, fire } = listening([{ ok: true, data: seat }]);
    const left: number[] = [];
    const went: string[] = [];
    const target = { ...sink(), leave: () => left.push(1), go: (id: string) => went.push(id) };
    followRematch(socket, target);
    fire(seat);
    await vi.waitFor(() => expect(went).toEqual(["NXT234"]));
    expect(sent).toEqual([{ event: "resumeSeat", args: [seat] }]);
    expect(left).toEqual([1]);
    expect(target.seated).toEqual([seat]);
  });

  it("stays put, saying why, if the seat is refused", async () => {
    const { socket, fire } = listening([{ ok: false, error: "no room with that code" }]);
    const went: string[] = [];
    const target = { ...sink(), leave: () => undefined, go: (id: string) => went.push(id) };
    followRematch(socket, target);
    fire({ roomId: "NXT234", seat: 1, token: "n1" });
    await vi.waitFor(() => expect(target.notices).toEqual(["no room with that code"]));
    expect(went).toEqual([]);
  });

  it("detaches its listener", () => {
    const { socket, handlers } = listening([]);
    const detach = followRematch(socket, {
      ...sink(),
      leave: () => undefined,
      go: () => undefined,
    });
    expect(handlers.size).toBe(1);
    detach();
    expect(handlers.size).toBe(0);
  });
});
