// @vitest-environment node
// Against a real server, so in Node rather than the simulated browser, as the
// other integration tests are; each device's storage is a map of its own.
/**
 * Watching a match back the moment it ends, against a real server: two players
 * with identities finish a match, the last result names the match it was kept
 * under, and the replay loads by that id through the client's own request, even
 * though the server is still writing the record when the first ask arrives.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAction } from "@hf/engine";
import { createServer, InMemoryMatchStore, type HandAndFootServer } from "@hf/server";
import type { MatchRecord, RoundEnded, UserCredentials } from "@hf/shared";
import { httpPost, prepareIdentity, type Post } from "./identity";
import { loadReplay, timelineOf } from "./routes/Replay";
import {
  connect,
  createRoom,
  joinRoom,
  startGame,
  submitAction,
  type HfClientSocket,
} from "./socket";

/** A device's local storage: just what `identity.ts` uses of it. */
function device(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as Storage;
}

/** Sit at a new device, under an identity of its own, and register it with the server. */
async function identityOn(post: Post, name: string): Promise<UserCredentials> {
  (globalThis as { window?: unknown }).window = { localStorage: device() };
  const user = await prepareIdentity(post, name);
  if (!user) throw new Error("no identity");
  return user;
}

/** Keeps matches as the server's own store does, but only after a while, as the Worker does. */
class SlowMatchStore extends InMemoryMatchStore {
  saved = 0;
  override async save(record: MatchRecord): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await super.save(record);
    this.saved++;
  }
}

let server: HandAndFootServer;
let url: string;
let matches: SlowMatchStore;
const sockets: HfClientSocket[] = [];

async function open(): Promise<HfClientSocket> {
  const socket = connect(url);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
  return socket;
}

beforeEach(async () => {
  matches = new SlowMatchStore();
  server = createServer({ matches });
  url = `http://localhost:${await server.listen(0)}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
  delete (globalThis as { window?: unknown }).window;
});

describe("watching the match back as it ends", () => {
  it("names the kept match in the last result, and loads its replay by that id", async () => {
    const asks: unknown[] = [];
    const http = httpPost(url);
    const post: Post = (path, body) => {
      asks.push(path);
      return http(path, body);
    };
    const anaUser = await identityOn(post, "Ana");
    const benUser = await identityOn(post, "Ben");
    asks.length = 0;

    const [ana, ben] = [await open(), await open()];
    const created = await createRoom(
      ana,
      "Ana",
      { rules: { extraDecks: 0, stockExhaustion: "end", rounds: 1, layDownMinimums: [60] } },
      anaUser,
    );
    if (!created.ok) throw new Error(created.error);
    await joinRoom(ben, created.data.roomId, "Ben", benUser);
    const ended = new Promise<RoundEnded>((resolve) =>
      ben.on("roundEnded", (result) => {
        if (result.matchOver) resolve(result);
      }),
    );
    await startGame(ana);

    // Each move goes over the wire from the seat that makes it; what is played is
    // not what is under test, so it is the safe default.
    const room = server.manager.get(created.data.roomId)!;
    const bySeat = [ana, ben];
    for (let guard = 0; !room.matchOver; guard++) {
      expect(guard).toBeLessThan(3_000);
      const state = room.gameState!;
      const sent = await submitAction(bySeat[state.currentSeat]!, defaultAction(state)!);
      if (!sent.ok) throw new Error(sent.error);
    }

    const result = await ended;
    expect(result.matchId).toBe(room.uid);
    // The record is still on its way to the store as the player asks for it.
    expect(matches.saved).toBe(0);

    const replay = await loadReplay(post, benUser, result.matchId!);
    if (!replay.ok) throw new Error(replay.error);
    // Asked twice: once before the record landed, once after.
    expect(asks).toEqual(["/api/users/match", "/api/users/match"]);
    expect(matches.saved).toBe(1);
    expect(replay.data.id).toBe(room.uid);
    expect(replay.data.seat).toBe(1);
    const timeline = timelineOf(replay.data);
    expect(timeline.length).toBe(room.log.length);
    const last = timeline.stateAt(timeline.length);
    expect(last.roundEnded).toBe(true);
    expect(timeline.nameOf(0)).toBe("Ana");
  });
});
