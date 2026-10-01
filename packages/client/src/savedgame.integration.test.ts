// @vitest-environment node
// Against a real server, so in Node rather than the simulated browser: Node's own
// WebSocket and jsdom each bring an Event class, and neither accepts the other's.
/**
 * A game saved for later, against a real server, through the client's own action
 * layer: saved mid-game, everyone leaves, and the players come back on new
 * connections — another day, as far as the server can tell — to a table that waits
 * for its host to pick it back up where it stopped.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type HandAndFootServer } from "@hf/server";
import type { RoomInfo, SeatCredentials } from "@hf/shared";
import { leaveTable, pauseTable, resumeSavedGame, saveTableForLater } from "./actions";
import { connect, createRoom, joinRoom, startGame, type HfClientSocket } from "./socket";

let server: HandAndFootServer;
let url: string;
const sockets: HfClientSocket[] = [];

async function open(): Promise<HfClientSocket> {
  const socket = connect(url);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

/** Stands in for the store: records what the action layer did with the seat. */
function sink(): {
  seated: SeatCredentials[];
  notices: (string | null)[];
  seat(c: SeatCredentials): void;
  leave(): void;
  setNotice(n: string | null): void;
} {
  return {
    seated: [],
    notices: [],
    seat(c) {
      this.seated.push(c);
    },
    leave() {},
    setNotice(n) {
      this.notices.push(n);
    },
  };
}

/** The next room broadcast on this socket that satisfies `test`. */
function nextRoom(socket: HfClientSocket, test: (room: RoomInfo) => boolean): Promise<RoomInfo> {
  return new Promise((resolve) => {
    const on = (room: RoomInfo): void => {
      if (!test(room)) return;
      socket.off("room", on);
      resolve(room);
    };
    socket.on("room", on);
  });
}

/** Three players at a dealt family table, each with their seat. */
async function dealtTable(): Promise<{
  roomId: string;
  seats: SeatCredentials[];
  sockets: HfClientSocket[];
}> {
  const [ana, ben, cy] = [await open(), await open(), await open()];
  const created = await createRoom(ana, "ana");
  if (!created.ok) throw new Error(created.error);
  const roomId = created.data.roomId;
  const joined = [await joinRoom(ben, roomId, "ben"), await joinRoom(cy, roomId, "cy")];
  const seats = [created.data, ...joined.map((j) => (j.ok ? j.data : null)!)];
  await startGame(ana);
  return { roomId, seats, sockets: [ana, ben, cy] };
}

beforeEach(async () => {
  server = createServer();
  url = `http://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
});

describe("a game saved for later", () => {
  it("is left by everyone, then picked back up by the host where it stopped", async () => {
    const {
      roomId,
      seats,
      sockets: [ana, ben, cy],
    } = await dealtTable();
    const before = server.manager.get(roomId)!.gameState!;

    // Ben saves it mid-turn: no pause first.
    const saved = nextRoom(ana!, (r) => r.savedUntil != null);
    expect(await saveTableForLater(ben!, sink())).toBe(true);
    expect((await saved).pausedBy).toBe(1);

    for (const socket of [ana!, ben!, cy!]) await leaveTable(socket, { leave() {} });

    // Later, on new connections. Ben is back first, then the host; Cy never comes.
    const benBack = await open();
    const benSink = sink();
    expect(await resumeSavedGame(benBack, seats[1]!, benSink)).toBe(true);
    expect(benSink.seated).toEqual([seats[1]]);
    const anaBack = await open();
    expect(await resumeSavedGame(anaBack, seats[0]!, sink())).toBe(true);

    // Only the host picks it back up while the host is here.
    const benTries = sink();
    expect(await pauseTable(benBack, false, benTries)).toBe(false);
    expect(benTries.notices).toEqual(["only the host can pick a saved game back up"]);

    const resumed = nextRoom(benBack, (r) => r.savedUntil == null);
    expect(await pauseTable(anaBack, false, sink())).toBe(true);
    const room = await resumed;
    expect(room.pausedBy).toBeUndefined();
    expect(room.players.map((p) => p.connected)).toEqual([true, true, false]);

    // The same game, from the same turn, with nobody's seat given up.
    const after = server.manager.get(roomId)!;
    expect(after.gameState).toEqual(before);
    expect(after.seats().map((p) => p.left)).toEqual([false, false, false]);
  });

  it("can be picked back up by anyone when the host does not come back", async () => {
    const {
      seats,
      sockets: [ana, ben],
    } = await dealtTable();
    await saveTableForLater(ana!, sink());
    await leaveTable(ana!, { leave() {} });
    await leaveTable(ben!, { leave() {} });

    const benBack = await open();
    await resumeSavedGame(benBack, seats[1]!, sink());
    expect(await pauseTable(benBack, false, sink())).toBe(true);
  });

  it("is forgotten, with a notice, when the table is gone", async () => {
    const back = await open();
    const s = sink();
    expect(await resumeSavedGame(back, { roomId: "ZZZZZZ", seat: 0, token: "nope" }, s)).toBe(
      false,
    );
    expect(s.notices).toEqual(["that saved game is no longer available"]);
    expect(s.seated).toEqual([]);
  });
});
