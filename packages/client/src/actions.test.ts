import { describe, it, expect, beforeEach } from "vitest";
import type { Ack, SeatCredentials } from "@hf/shared";
import {
  createTable,
  joinTable,
  pauseTable,
  play,
  resumeStoredSeat,
  startTable,
  type ActionSink,
} from "./actions";
import { CREDENTIALS_KEY, loadCredentials, saveCredentials } from "./credentials";
import type { HfClientSocket } from "./socket";

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

describe("resumeStoredSeat", () => {
  it("keeps the seat when the server honours the token", async () => {
    const { socket, sent } = fakeSocket([{ ok: true, data: undefined }]);
    const target = sink();
    saveCredentials(credentials);
    expect(await resumeStoredSeat(socket, credentials, target)).toBe(true);
    expect(sent[0].event).toBe("resumeSeat");
    expect(target.seated).toEqual([credentials]);
    expect(loadCredentials()).toEqual(credentials);
  });

  it("discards the credentials when the seat is gone", async () => {
    // Expected rather than exceptional: the round may have finished, the room may
    // have been reaped, or the token may predate a restart. Keeping them would
    // retry a doomed reclaim on every load.
    const { socket } = fakeSocket([{ ok: false, error: "that seat is not yours" }]);
    const target = sink();
    saveCredentials(credentials);
    expect(await resumeStoredSeat(socket, credentials, target)).toBe(false);
    expect(loadCredentials()).toBeNull();
    expect(target.seated).toEqual([]);
  });

  it("stays silent about a refusal", async () => {
    // The player did not ask for this; telling them a seat they had forgotten about
    // is gone would be noise on a fresh load.
    const { socket } = fakeSocket([{ ok: false, error: "that seat is not yours" }]);
    const target = sink();
    await resumeStoredSeat(socket, credentials, target);
    expect(target.notices).toEqual([]);
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
