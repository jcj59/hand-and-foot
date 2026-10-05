// @vitest-environment node
// Against a real server, so in Node rather than the simulated browser.
/**
 * Watching a table through the client's own transport and session store, against
 * a real server: a watcher is sent the table as it is played, with no hand, no
 * foot and no hidden card of anyone's in what reaches the store.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type HandAndFootServer } from "@hf/server";
import { defaultAction } from "@hf/engine";
import type { ViewUpdate } from "@hf/shared";
import { attachSession, useSession } from "./session";
import { connect, createRoom, joinRoom, startGame, watchRoom, type HfClientSocket } from "./socket";

let server: HandAndFootServer;
let url: string;
const sockets: HfClientSocket[] = [];

async function open(): Promise<HfClientSocket> {
  const socket = connect(url);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

beforeEach(async () => {
  server = createServer();
  url = `http://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
});

describe("watching a table, from the client", () => {
  it("puts the table in the store as a spectator sees it, and never a hidden card", async () => {
    const [ana, ben] = [await open(), await open()];
    const created = await createRoom(ana, "ana");
    if (!created.ok) throw new Error(created.error);
    const roomId = created.data.roomId;
    await joinRoom(ben, roomId, "ben");

    const watcher = await open();
    const seen: ViewUpdate[] = [];
    watcher.on("view", (u) => seen.push(u));
    const detach = attachSession(watcher, useSession.getState());
    try {
      const watched = await watchRoom(watcher, roomId);
      expect(watched.ok && watched.data.players.map((p) => p.name)).toEqual(["ana", "ben"]);
      await startGame(ana);
      const room = server.manager.get(roomId)!;
      for (let i = 0; i < 25; i++) {
        const state = room.gameState!;
        room.submitAction(state.currentSeat, defaultAction(state)!);
        room.onChange?.();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      const stored = useSession.getState().update!;
      expect(stored.view.seat).toBe(-1);
      expect(stored.room.watching).toBe(1);
      const hidden = room
        .gameState!.players.flatMap((p) => [...p.hand, ...p.foot])
        .map((c) => c.id);
      for (const update of seen) {
        const sent = JSON.stringify(update);
        expect(update.view.hand).toEqual([]);
        for (const id of hidden) expect(sent).not.toContain(`"${id}"`);
      }
      expect(seen.length).toBeGreaterThan(20);
    } finally {
      detach();
    }
  });
});
