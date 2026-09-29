/**
 * Playing again, against a real server: two players finish a round, each asks to
 * play again through the client's own action layer, and both end up seated in the
 * same new waiting room, where the host deals the next game.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type HandAndFootServer } from "@hf/server";
import type { SeatCredentials } from "@hf/shared";
import { playAgain } from "./actions";
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
  left: number;
  notices: (string | null)[];
  seat(c: SeatCredentials): void;
  leave(): void;
  setNotice(n: string | null): void;
} {
  return {
    seated: [],
    left: 0,
    notices: [],
    seat(c) {
      this.seated.push(c);
    },
    leave() {
      this.left++;
    },
    setNotice(n) {
      this.notices.push(n);
    },
  };
}

beforeEach(async () => {
  server = createServer();
  url = `http://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
});

describe("playing again", () => {
  it("seats both players in the same new waiting room, where the host deals", async () => {
    const [ana, ben] = [await open(), await open()];
    const created = await createRoom(ana, "ana");
    if (!created.ok) throw new Error(created.error);
    await joinRoom(ben, created.data.roomId, "ben");
    await startGame(ana);
    // End the match on the server; how rounds end is not what is under test.
    const room = server.manager.get(created.data.roomId)!;
    const state = room.gameState!;
    Object.assign(room as unknown as { state: typeof state }, {
      state: { ...state, roundEnded: true, roundNumber: state.config.rounds },
    });

    const anaSink = sink();
    const benSink = sink();
    const first = await playAgain(ana, anaSink);
    const second = await playAgain(ben, benSink);

    expect(first).not.toBeNull();
    expect(first).not.toBe(created.data.roomId);
    expect(second).toBe(first);
    expect(anaSink.left).toBe(1);
    expect(anaSink.seated).toEqual([expect.objectContaining({ roomId: first, seat: 0 })]);
    expect(benSink.seated).toEqual([expect.objectContaining({ roomId: first, seat: 1 })]);

    // The first to go hosts the new table; dealing it starts the next game.
    expect(await startGame(ana)).toEqual({ ok: true, data: undefined });
    expect(server.manager.get(first!)!.gameState!.players).toHaveLength(2);
  });
});
