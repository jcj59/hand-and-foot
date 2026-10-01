import { describe, it, expect } from "vitest";
import { FakeClock } from "./clock";
import { nextTableFor, openTable, sitAt } from "./lobby";
import { RoomManager } from "./manager";
import { Room } from "./room";
import { InMemoryRoomStore } from "./store";

describe("a seat's identity", () => {
  it("is kept with the seat, and comes back with it after a restart", async () => {
    const store = new InMemoryRoomStore();
    const manager = new RoomManager({ clock: new FakeClock(), store });
    const opened = openTable(manager, "Ana", undefined, "ana-user-id-0001");
    if (!opened.ok) throw new Error(opened.error);
    expect(sitAt(manager, opened.data.roomId, "Guest", null).ok).toBe(true);
    const [stored] = await store.loadOpen();
    expect(stored!.room.players.map((p) => p.userId)).toEqual(["ana-user-id-0001", undefined]);
    const back = Room.restore(stored!, { clock: new FakeClock(), newToken: () => "t" });
    if (!back.ok) throw new Error(back.error);
    expect(back.value.seats().map((p) => p.userId)).toEqual(["ana-user-id-0001", undefined]);
  });

  it("goes with the player to the next game's table", () => {
    const manager = new RoomManager({ clock: new FakeClock() });
    const opened = openTable(manager, "Ana", undefined, "ana-user-id-0001");
    if (!opened.ok) throw new Error(opened.error);
    const room = manager.get(opened.data.roomId)!;
    const moved = nextTableFor(manager, room, room.seats()[0]!);
    if (!moved.ok) throw new Error(moved.error);
    const next = manager.get(moved.value.roomId)!;
    expect(next.seats()[0]!.userId).toBe("ana-user-id-0001");
  });
});
