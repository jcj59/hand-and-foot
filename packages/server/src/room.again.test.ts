/**
 * Playing again at the same table once a round is over: everyone still here asks,
 * and a fresh game is dealt to the same players in the same room.
 */
import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { defaultAction } from "@hf/engine";
import { FakeClock } from "./clock";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";

/** A short game: no extra decks, and the round ends when the stock does. */
const SHORT: RulesConfig = { ...EAST_COAST, extraDecks: 0, stockExhaustion: "end" };

function finishedTable(names: readonly string[], store?: InMemoryRoomStore): Room {
  let token = 0;
  let seed = 100;
  let uid = 0;
  const room = new Room("AGAIN1", SHORT, {
    clock: new FakeClock(),
    seed: 7,
    newToken: () => `t${token++}`,
    newSeed: () => seed++,
    newUid: () => `game-${++uid}`,
    uid: "game-0",
    store,
  });
  store?.saveRoom(room.record());
  for (const name of names) expect(room.join(name).ok).toBe(true);
  expect(room.start(0).ok).toBe(true);
  for (let guard = 0; !room.gameState!.roundEnded; guard++) {
    expect(guard).toBeLessThan(2_000);
    const state = room.gameState!;
    expect(room.submitAction(state.currentSeat, defaultAction(state)!).ok).toBe(true);
  }
  return room;
}

describe("playing again", () => {
  it("shows who has asked, and deals once everyone has", () => {
    const room = finishedTable(["ana", "ben", "cy"]);
    expect(room.info().playAgain).toEqual([]);
    expect(room.playAgain(1)).toEqual({ ok: true, value: false });
    expect(room.playAgain(0)).toEqual({ ok: true, value: false });
    expect(room.info().playAgain).toEqual([0, 1]);
    expect(room.gameState!.roundEnded).toBe(true);

    expect(room.playAgain(2)).toEqual({ ok: true, value: true });
    expect(room.gameState!.roundEnded ?? false).toBe(false);
    expect(room.gameState!.players).toHaveLength(3);
    expect(room.info()).toMatchObject({ gameNumber: 2, playAgain: [], started: true });
    expect(room.seats().map((p) => p.name)).toEqual(["ana", "ben", "cy"]);
  });

  it("counts asking twice once", () => {
    const room = finishedTable(["ana", "ben"]);
    room.playAgain(0);
    expect(room.playAgain(0)).toEqual({ ok: true, value: false });
    expect(room.info().playAgain).toEqual([0]);
  });

  it("deals a new game, not the same one again", () => {
    const room = finishedTable(["ana", "ben"]);
    const before = room.gameState!;
    room.playAgain(0);
    room.playAgain(1);
    expect(room.gameState!.seed).not.toBe(before.seed);
    expect(room.log.length).toBe(0);
    // And the clock runs for the new game's first turn.
    expect(room.clockState().deadlineAt).not.toBeNull();
  });

  it("drops a player who left, closes the seats up, and plays on without them", () => {
    const room = finishedTable(["ana", "ben", "cy"]);
    room.playAgain(0);
    room.playAgain(2);
    // Ben goes home instead; that was the last answer anyone was waiting on.
    expect(room.leave("t1").ok).toBe(true);
    expect(room.info().gameNumber).toBe(2);
    expect(room.seats().map((p) => [p.seat, p.name])).toEqual([
      [0, "ana"],
      [1, "cy"],
    ]);
    expect(room.gameState!.players).toHaveLength(2);
  });

  it("will not deal a game for one player left alone", () => {
    const room = finishedTable(["ana", "ben"]);
    room.playAgain(0);
    room.leave("t1");
    expect(room.info().gameNumber).toBe(1);
    expect(room.gameState!.roundEnded).toBe(true);
  });

  it("is refused before the round is over", () => {
    let token = 0;
    const room = new Room("AGAIN2", SHORT, {
      clock: new FakeClock(),
      seed: 7,
      newToken: () => `t${token++}`,
    });
    room.join("ana");
    room.join("ben");
    expect(room.playAgain(0)).toEqual({ ok: false, error: "the round is not over yet" });
    room.start(0);
    expect(room.playAgain(0)).toEqual({ ok: false, error: "the round is not over yet" });
  });

  it("keeps each game as its own record in storage", async () => {
    const store = new InMemoryRoomStore();
    const room = finishedTable(["ana", "ben"], store);
    const firstMoves = room.log.length;
    room.playAgain(0);
    room.playAgain(1);
    expect(store.closedAt("game-0")).not.toBeNull();
    const open = await store.loadOpen();
    expect(open.map((r) => r.room.uid)).toEqual(["game-1"]);
    expect(open[0]!.room.started).toBe(true);
    expect(open[0]!.room.seed).toBe(100);
    expect(firstMoves).toBeGreaterThan(0);

    // A restart brings back the second game, not the first.
    const restored = Room.restore(open[0]!, { clock: new FakeClock(), newToken: () => "x" });
    expect(restored.ok && restored.value.gameState).toEqual(room.gameState);
  });

  it("falls back to a derived seed and identity when none are supplied", () => {
    let token = 0;
    const room = new Room("AGAIN3", SHORT, {
      clock: new FakeClock(),
      seed: 7,
      newToken: () => `t${token++}`,
    });
    room.join("ana");
    room.join("ben");
    room.start(0);
    for (let guard = 0; !room.gameState!.roundEnded && guard < 2_000; guard++) {
      const state = room.gameState!;
      room.submitAction(state.currentSeat, defaultAction(state)!);
    }
    room.playAgain(0);
    room.playAgain(1);
    expect(room.gameState!.seed).toBe(8);
    expect(room.uid).toBe("AGAIN3#2");
  });
});
