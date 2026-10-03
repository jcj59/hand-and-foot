/** Who a rematch brings to the next table, and who may ask for one. */
import { describe, it, expect } from "vitest";
import { EAST_COAST, type RulesConfig } from "@hf/shared";
import { defaultAction } from "@hf/engine";
import { FakeClock } from "./clock";
import { RoomManager } from "./manager";
import { rematchFor } from "./lobby";
import { Room } from "./room";

const ONE: RulesConfig = {
  ...EAST_COAST,
  extraDecks: 0,
  stockExhaustion: "end",
  rounds: 1,
  layDownMinimums: [60],
};

function finished(names: readonly string[], bots = 0): Room {
  let token = 0;
  const room = new Room("DONE23", ONE, {
    clock: new FakeClock(),
    seed: 21,
    newToken: () => `t${token++}`,
    pauseWhenIdle: false,
  });
  for (const name of names) room.join(name, { userId: `u-${name}` });
  for (let i = 0; i < bots; i++) room.addBot(0);
  room.start(0);
  for (let guard = 0; !room.matchOver; guard++) {
    expect(guard).toBeLessThan(5_000);
    const state = room.gameState!;
    room.submitAction(state.currentSeat, defaultAction(state)!);
  }
  return room;
}

describe("asking for a rematch", () => {
  it("brings everyone still at the table, computers too, in their seats' order", () => {
    const room = finished(["ana", "ben"], 1);
    const coming = room.rematchPlayers(0);
    expect(coming.ok && coming.value.map((p) => p.name)).toEqual(["ana", "ben", "Robo Rita"]);
  });

  it("leaves out anyone who has gone on to a new game or walked away", () => {
    const room = finished(["ana", "ben", "cy"]);
    room.leave("t2");
    const coming = room.rematchPlayers(0);
    expect(coming.ok && coming.value.map((p) => p.name)).toEqual(["ana", "ben"]);
  });

  it("is the host's, once the match is over, and only before anyone has gone on", () => {
    const room = finished(["ana", "ben"]);
    expect(room.rematchPlayers(1)).toEqual({
      ok: false,
      error: "only the host can start a rematch",
    });
    room.nextRoomId = "NXT234";
    expect(room.rematchPlayers(0)).toEqual({
      ok: false,
      error: "someone has already gone on to a new game; play again to join them",
    });
    let token = 0;
    const playing = new Room("LIVE23", ONE, {
      clock: new FakeClock(),
      seed: 1,
      newToken: () => `x${token++}`,
    });
    playing.join("ana");
    playing.join("ben");
    playing.start(0);
    expect(playing.rematchPlayers(0)).toEqual({ ok: false, error: "the match is not over yet" });
  });

  it("needs two players still there", () => {
    const room = finished(["ana", "ben"]);
    room.leave("t1");
    expect(room.rematchPlayers(0)).toEqual({ ok: false, error: "a game needs at least 2 players" });
  });
});

describe("the rematch's table", () => {
  it("is dealt at once, with the same rules, seats, computers and host", () => {
    const manager = new RoomManager({ clock: new FakeClock() });
    const room = manager.create(ONE);
    room.join("ana", { userId: "u-ana" });
    room.addBot(0);
    room.join("ben", { userId: "u-ben" });
    expect(room.setHost(0, 2).ok).toBe(true);
    room.start(2);
    for (let guard = 0; !room.matchOver; guard++) {
      const state = room.gameState!;
      room.submitAction(state.currentSeat, defaultAction(state)!);
    }
    const coming = room.rematchPlayers(2);
    if (!coming.ok) throw new Error(coming.error);
    const moved = rematchFor(manager, room, coming.value);
    if (!moved.ok) throw new Error(moved.error);
    const next = manager.get(room.nextRoomId!)!;
    expect(next.started).toBe(true);
    expect(next.config).toEqual(ONE);
    expect(next.seats().map((p) => [p.name, p.bot ?? false, p.userId])).toEqual([
      ["ana", false, "u-ana"],
      ["Robo Rita", true, undefined],
      ["ben", false, "u-ben"],
    ]);
    expect(next.hostSeat).toBe(2);
    // Each person's seat there, by their token here; the computer has none to carry.
    expect([...moved.value.entries()].map(([t, s]) => [t, s.roomId, s.seat])).toEqual([
      [room.seats()[0]!.token, next.id, 0],
      [room.seats()[2]!.token, next.id, 2],
    ]);
    expect(next.seatOf(moved.value.get(room.seats()[0]!.token)!.token)!.connected).toBe(false);
  });
});
